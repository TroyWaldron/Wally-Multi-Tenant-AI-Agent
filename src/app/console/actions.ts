"use server";

// Console mutations. Each one re-checks the session and uses the signed-in
// user's RLS-scoped store, so the database decides what they may change.
import { revalidatePath } from "next/cache";
import { runWorkflow, sendEvent, notify } from "@/lib/n8n";
import { getRole } from "@/lib/roles";
import { STARTER_AGENCY, STARTER_AGENTS, STARTER_KNOWLEDGE, STARTER_TENANT } from "@/lib/seed/starter";
import { getSession, systemStore } from "@/lib/session";
import { SETTING_DEFS } from "@/lib/settings";
import { syncKnowledge } from "@/lib/knowledgeSync";
import { isSupabaseConfigured, serviceClient } from "@/lib/supabase";
import type { Agent, Channel, Tenant } from "@/lib/types";

export type ActionResult = { ok: true; message?: string; data?: unknown } | { ok: false; error: string };

async function ctx(tenantId: string) {
  const session = await getSession();
  if (!session) throw new Error("Your session expired. Sign in again.");
  const tenant = await session.store.getTenant(tenantId);
  if (!tenant) throw new Error("You don't have access to that business.");
  return { session, tenant, store: session.store, actor: session.user.email };
}

async function wrap(fn: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    const r = await fn();
    revalidatePath("/console");
    return r ?? { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

/* ------------------------------------------------------------------ agents */

export async function saveAgent(tenantId: string, input: Omit<Agent, "createdAt" | "updatedAt" | "tenantId" | "id"> & { id?: string }) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    if (!input.name.trim()) return { ok: false, error: "Give the agent a name." };
    const saved = await store.saveAgent(tenant.id, input);
    await store.audit(tenant.id, { actorType: "user", actor, action: input.id ? "agent.updated" : "agent.hired", detail: { agentId: saved.id, name: saved.name, status: saved.status } });
    return { ok: true, message: `${saved.name} saved.`, data: saved.id };
  });
}

export async function hireAgent(tenantId: string, templateKey: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    const role = getRole(templateKey);
    if (!role) return { ok: false, error: "Unknown role." };
    const saved = await store.saveAgent(tenant.id, {
      templateKey,
      name: role.name,
      title: role.name,
      avatar: null,
      status: "draft",
      model: "claude-opus-5",
      fallbackModel: "claude-haiku-4-5",
      effort: "medium",
      instructions: "",
      personality: role.defaultPersonality,
      boundaries: role.defaultBoundaries,
      channels: ["playground"],
      voice: {},
      monthlyBudgetUsd: 25,
    });
    await store.audit(tenant.id, { actorType: "user", actor, action: "agent.hired", detail: { agentId: saved.id, role: templateKey } });
    return { ok: true, message: `${role.name} added as a draft.`, data: saved.id };
  });
}

export async function deleteAgent(tenantId: string, agentId: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    await store.deleteAgent(tenant.id, agentId);
    await store.audit(tenant.id, { actorType: "user", actor, action: "agent.removed", detail: { agentId } });
  });
}

/* --------------------------------------------------------------- approvals */

export async function decideApproval(tenantId: string, approvalId: string, decision: "approved" | "rejected") {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    const a = await store.decideApproval(tenant.id, approvalId, decision, actor);
    if (!a) return { ok: false, error: "That request was already decided." };
    await store.audit(tenant.id, { actorType: "user", actor, action: `approval.${decision}`, detail: { approvalId, action: a.action } });

    let note = decision === "approved" ? `The team approved: ${a.summary}` : `The team declined: ${a.summary}`;
    // Approved workflow actions run now, so the agent's request actually happens.
    if (decision === "approved" && typeof a.payload.workflow === "string") {
      const r = await runWorkflow(tenant, a.payload.workflow, (a.payload.input as Record<string, unknown>) ?? {}, { approvalId, approvedBy: actor });
      note += r.ok ? ` (workflow ${a.payload.workflow} ran)` : ` (workflow ${a.payload.workflow} could not run: ${r.error ?? `HTTP ${r.status}`})`;
    }
    if (a.conversationId) await store.addMessage(tenant.id, { conversationId: a.conversationId, role: "system", content: note, meta: { approvalId } });
    notify(tenant, "approval_decided", { approval: a });
    return { ok: true, message: decision === "approved" ? "Approved." : "Declined." };
  });
}

/* ----------------------------------------------------------- conversations */

export async function staffReply(tenantId: string, conversationId: string, text: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    const conv = await store.getConversation(tenant.id, conversationId);
    if (!conv || !text.trim()) return { ok: false, error: "Write a reply first." };
    await store.addMessage(tenant.id, { conversationId, role: "staff", content: text.trim(), meta: { by: actor } });
    // n8n delivers it on the original channel (WhatsApp, email...).
    notify(tenant, "agent_replied", { conversationId, channel: conv.channel, contact: conv.contact, reply: text.trim(), agent: actor, fromStaff: true });
    return { ok: true, message: "Reply sent." };
  });
}

export async function setConversationStatus(tenantId: string, conversationId: string, status: "open" | "waiting_human" | "closed") {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    await store.setConversationStatus(tenant.id, conversationId, status);
    await store.audit(tenant.id, { actorType: "user", actor, action: `conversation.${status}`, detail: { conversationId } });
  });
}

export async function loadMessages(tenantId: string, conversationId: string) {
  const { store, tenant } = await ctx(tenantId);
  return store.listMessages(tenant.id, conversationId);
}

/* --------------------------------------------------------------- knowledge */

export async function addKnowledge(tenantId: string, title: string, content: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    if (!title.trim() || !content.trim()) return { ok: false, error: "Add a title and some content." };
    await store.addKnowledge(tenant.id, { title: title.trim(), content: content.trim(), source: "console" });
    await store.audit(tenant.id, { actorType: "user", actor, action: "knowledge.added", detail: { title } });
    return { ok: true, message: "Added to the knowledge base." };
  });
}

export async function deleteKnowledge(tenantId: string, id: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    await store.deleteKnowledge(tenant.id, id);
    await store.audit(tenant.id, { actorType: "user", actor, action: "knowledge.removed", detail: { id } });
  });
}

export async function syncKnowledgeNow(tenantId: string) {
  return wrap(async () => {
    const { tenant } = await ctx(tenantId);
    const r = await syncKnowledge(tenant);
    if (!r.ok) return r;
    return { ok: true, message: `Synced ${r.imported} articles from the website.` };
  });
}

export async function testKnowledgeSearch(tenantId: string, query: string) {
  const { store, tenant } = await ctx(tenantId);
  return store.searchKnowledge(tenant.id, query);
}

/* ---------------------------------------------------------------- business */

export async function saveTenant(tenantId: string, patch: Pick<Tenant, "name" | "industry" | "currency" | "timezone" | "status" | "profile" | "branding">) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    await store.updateTenant(tenant.id, patch);
    await store.audit(tenant.id, { actorType: "user", actor, action: "business.updated", detail: {} });
    return { ok: true, message: "Business details saved." };
  });
}

export async function createTenant(name: string) {
  return wrap(async () => {
    const session = await getSession();
    if (!session?.isPlatformAdmin) return { ok: false, error: "Only platform admins can add a business." };
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    if (!slug) return { ok: false, error: "Enter a business name." };
    const t = await session.store.createTenant({ name: name.trim(), slug });
    await session.store.audit(t.id, { actorType: "user", actor: session.user.email, action: "business.created", detail: { name } });
    return { ok: true, message: `${t.name} added.`, data: t.slug };
  });
}

/* ---------------------------------------------------------------- channels */

export async function saveChannel(tenantId: string, ch: Omit<Channel, "id" | "tenantId"> & { id?: string }) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    if (!ch.externalId.trim()) return { ok: false, error: "Enter the number, address or ID for this channel." };
    await store.saveChannel(tenant.id, { ...ch, externalId: ch.externalId.trim() });
    await store.audit(tenant.id, { actorType: "user", actor, action: "channel.saved", detail: { kind: ch.kind, externalId: ch.externalId } });
    return { ok: true, message: "Channel saved." };
  });
}

export async function deleteChannel(tenantId: string, id: string) {
  return wrap(async () => {
    const { store, tenant } = await ctx(tenantId);
    await store.deleteChannel(tenant.id, id);
  });
}

/* ---------------------------------------------------------------- settings */

export async function saveSetting(tenantId: string, key: string, value: string) {
  return wrap(async () => {
    const { session, tenant, actor } = await ctx(tenantId);
    const def = SETTING_DEFS.find((d) => d.key === key);
    if (!def) return { ok: false, error: "Unknown setting." };
    if (def.scope === "platform" && !session.isPlatformAdmin) return { ok: false, error: "Only platform admins can change this." };
    const scopeId = def.scope === "tenant" ? tenant.id : null;
    // Settings live behind the service role; access was checked above.
    const store = systemStore();
    if (value.trim()) await store.setSetting(scopeId, key, value.trim(), def.secret);
    else if (!def.secret) await store.deleteSetting(scopeId, key);
    await session.store.audit(tenant.id, { actorType: "user", actor, action: "setting.changed", detail: { key, scope: def.scope } });
    return { ok: true, message: `${def.label} saved.` };
  });
}

export async function clearSetting(tenantId: string, key: string) {
  return wrap(async () => {
    const { session, tenant } = await ctx(tenantId);
    const def = SETTING_DEFS.find((d) => d.key === key);
    if (!def) return { ok: false, error: "Unknown setting." };
    if (def.scope === "platform" && !session.isPlatformAdmin) return { ok: false, error: "Only platform admins can change this." };
    await systemStore().deleteSetting(def.scope === "tenant" ? tenant.id : null, key);
    return { ok: true, message: `${def.label} cleared.` };
  });
}

export async function testN8n(tenantId: string) {
  const { tenant } = await ctx(tenantId);
  const r = await sendEvent(tenant, "test_ping", { message: "Test event from the Wally console" });
  if (r.ok) return { ok: true as const, message: `n8n answered HTTP ${r.status}${r.body ? `: ${JSON.stringify(r.body).slice(0, 200)}` : ""}` };
  return { ok: false as const, error: r.error ?? `n8n answered HTTP ${r.status}` };
}

/* --------------------------------------------------------------- bootstrap */

/** Supabase mode: create Novate + Sunsational with starter agents and knowledge. */
export async function loadStarterData() {
  return wrap(async () => {
    const session = await getSession();
    if (!session?.isPlatformAdmin) return { ok: false, error: "Only platform admins can load starter data." };
    if (!isSupabaseConfigured()) return { ok: false, error: "Demo mode already has the starter data." };
    const store = systemStore();
    if (await store.getTenantBySlug(STARTER_TENANT.slug)) return { ok: false, error: "Sunsational Tobago is already set up." };

    const db = serviceClient();
    const { data: agency, error } = await db.from("agencies").upsert(STARTER_AGENCY, { onConflict: "slug" }).select("id").single();
    if (error) return { ok: false, error: error.message };
    const tenant = await store.createTenant({ ...STARTER_TENANT, agencyId: agency.id });
    for (const a of STARTER_AGENTS) await store.saveAgent(tenant.id, a);
    for (const k of STARTER_KNOWLEDGE) await store.addKnowledge(tenant.id, k);
    await store.audit(tenant.id, { actorType: "user", actor: session.user.email, action: "tenant.seeded", detail: {} });
    return { ok: true, message: "Sunsational Tobago is ready.", data: tenant.slug };
  });
}
