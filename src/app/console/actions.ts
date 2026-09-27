"use server";

// Console mutations. Each one re-checks the session and uses the signed-in
// user's RLS-scoped store, so the database decides what they may change.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { runScenarios } from "@/lib/scenarioRunner";
import { runWorkflow, sendEvent, notify } from "@/lib/n8n";
import { getRole } from "@/lib/roles";
import { suggestedPlan } from "@/lib/billing";
import { STARTER_AGENCY, STARTER_AGENTS, STARTER_KNOWLEDGE, STARTER_TENANT } from "@/lib/seed/starter";
import { getSession, systemStore } from "@/lib/session";
import { SETTING_DEFS } from "@/lib/settings";
import { sendStaffReply } from "@/lib/staffReply";
import { helpdeskFromWally, isHelpdesk } from "@/lib/helpdesk";
import { syncKnowledge } from "@/lib/knowledgeSync";
import { isSupabaseConfigured, serviceClient } from "@/lib/supabase";
import { callConnectorTool, listConnectorTools, tokenKey } from "@/lib/mcp";
import type { Agent, Channel, Connector, Contract, Tenant } from "@/lib/types";

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
    // Every change to a live agent re-runs its scenario tests in the background.
    if (saved.status === "live") {
      after(() => runScenarios(store, tenant, saved, "change").catch((err) => console.error("Scenario tests failed to run", err)));
    }
    return { ok: true, message: `${saved.name} saved.${saved.status === "live" ? " Scenario tests are re-running." : ""}`, data: saved.id };
  });
}

export async function runAgentTests(tenantId: string, agentId: string) {
  return wrap(async () => {
    const { store, tenant } = await ctx(tenantId);
    const agent = (await store.listAgents(tenant.id)).find((a) => a.id === agentId);
    if (!agent) return { ok: false, error: "Agent not found." };
    const run = await runScenarios(store, tenant, agent, "manual");
    if (run.skipped) return { ok: false, error: run.skipped };
    return { ok: true, message: `${agent.name} passed ${run.passed} of ${run.total} scenario tests.` };
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

export async function decideApproval(tenantId: string, approvalId: string, decision: "approved" | "rejected", lesson?: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    const a = await store.decideApproval(tenant.id, approvalId, decision, actor);
    if (!a) return { ok: false, error: "That request was already decided." };
    await store.audit(tenant.id, { actorType: "user", actor, action: `approval.${decision}`, detail: { approvalId, action: a.action } });

    let note = decision === "approved" ? `The team approved: ${a.summary}` : `The team declined: ${a.summary}`;
    // Accountability loop: a reason given when declining becomes a standing
    // rule on the agent ("Can't do"), so it stops asking for the same thing.
    const rule = lesson?.trim().slice(0, 200);
    let learned = "";
    if (decision === "rejected" && rule && a.agentId) {
      const agent = (await store.listAgents(tenant.id)).find((x) => x.id === a.agentId);
      if (agent && !agent.boundaries.cannot.some((c) => c.toLowerCase() === rule.toLowerCase())) {
        await store.saveAgent(tenant.id, { ...agent, boundaries: { ...agent.boundaries, cannot: [...agent.boundaries.cannot, rule] } });
        await store.audit(tenant.id, { actorType: "user", actor, action: "policy.learned", detail: { agentId: agent.id, rule, approvalId } });
        learned = ` ${agent.name} will follow this from now on.`;
      }
      note += ` Reason: ${rule}`;
    }
    // Approved workflow actions run now, so the agent's request actually happens.
    if (decision === "approved" && typeof a.payload.workflow === "string") {
      const r = await runWorkflow(tenant, a.payload.workflow, (a.payload.input as Record<string, unknown>) ?? {}, { approvalId, approvedBy: actor });
      note += r.ok ? ` (workflow ${a.payload.workflow} ran)` : ` (workflow ${a.payload.workflow} could not run: ${r.error ?? `HTTP ${r.status}`})`;
    }
    if (decision === "approved" && typeof a.payload.connectorId === "string" && typeof a.payload.tool === "string") {
      const c = (await store.listConnectors(tenant.id)).find((x) => x.id === a.payload.connectorId);
      try {
        if (!c) throw new Error("connector removed");
        const out = await callConnectorTool(c, a.payload.tool, (a.payload.arguments as Record<string, unknown>) ?? {});
        note += ` (${c.name} did it: ${out.slice(0, 300)})`;
      } catch (err) {
        note += ` (${a.payload.tool} could not run: ${err instanceof Error ? err.message : "error"})`;
      }
    }
    if (a.conversationId) await store.addMessage(tenant.id, { conversationId: a.conversationId, role: "system", content: note, meta: { approvalId } });
    notify(tenant, "approval_decided", { approval: a });
    return { ok: true, message: decision === "approved" ? "Approved." : `Declined.${learned}` };
  });
}

/* ----------------------------------------------------------- conversations */

export async function staffReply(tenantId: string, conversationId: string, text: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    const conv = await store.getConversation(tenant.id, conversationId);
    if (!conv || !text.trim()) return { ok: false, error: "Write a reply first." };
    await sendStaffReply(store, tenant, conv, text.trim(), actor);
    return { ok: true, message: "Reply sent." };
  });
}

export async function helpdeskReply(tenantId: string, ticketId: string, text: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    const ticket = await store.getConversation(tenant.id, ticketId);
    if (!isHelpdesk(ticket) || !text.trim()) return { ok: false, error: "Write a reply first." };
    await helpdeskFromWally(store, tenant.id, ticket, text.trim(), actor);
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

export type OnboardInput = {
  name: string;
  industry: string;
  currency: string;
  timezone: string;
  profile: Tenant["profile"];
  staff: { roleKey: string; name: string }[];
  knowledge: string;
  knowledgeUrl: string;
  introPricing: boolean;
};

/**
 * Onboarding in one step: the business, its first AI staff (as drafts to
 * test before going live), its knowledge, and agreements at the
 * introductory price for each role.
 */
export async function onboardBusiness(input: OnboardInput) {
  return wrap(async () => {
    const session = await getSession();
    if (!session?.isPlatformAdmin) return { ok: false, error: "Only platform admins can add a business." };
    const name = input.name.trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    if (!slug) return { ok: false, error: "Enter a business name." };
    const { store } = session;
    const t = await store.createTenant({ name, slug });
    const frontName = input.staff.find((s) => getRole(s.roleKey)?.category === "Front desk")?.name;
    await store.updateTenant(t.id, {
      name,
      industry: input.industry.trim() || null,
      currency: input.currency,
      timezone: input.timezone,
      status: "trial",
      profile: input.profile,
      branding: { color: "#1c7f7a", position: "right", welcome: `Hi, I'm ${frontName ?? "the team's assistant"} at ${name}. How can I help?` },
    });
    const today = new Date().toISOString().slice(0, 10);
    for (const s of input.staff) {
      const role = getRole(s.roleKey);
      if (!role) continue;
      const guestFacing = role.category === "Front desk" || role.category === "Revenue";
      const agent = await store.saveAgent(t.id, {
        templateKey: role.key,
        name: s.name.trim() || role.name,
        title: role.name,
        avatar: null,
        status: "draft",
        model: "claude-opus-5",
        fallbackModel: "claude-haiku-4-5",
        effort: "medium",
        instructions: "",
        personality: role.defaultPersonality,
        boundaries: role.defaultBoundaries,
        channels: guestFacing ? ["playground", "web"] : ["playground", "ops"],
        voice: {},
        monthlyBudgetUsd: 25,
      });
      if (input.introPricing) {
        await store.saveContract(t.id, { agentId: agent.id, ...suggestedPlan(role.key, role.name), startsOn: today, endsOn: null, status: "active", notes: "Introductory price, set at onboarding." });
      }
    }
    if (input.knowledge.trim()) await store.addKnowledge(t.id, { title: `About ${name}`, content: input.knowledge.trim(), source: "console" });
    if (input.knowledgeUrl.trim()) await systemStore().setSetting(t.id, "KNOWLEDGE_SYNC_URL", input.knowledgeUrl.trim(), false);
    await store.audit(t.id, { actorType: "user", actor: session.user.email, action: "business.onboarded", detail: { name, staff: input.staff.map((s) => s.roleKey), introPricing: input.introPricing } });
    return { ok: true, message: `${name} is set up. Test the new staff in the Playground, then set them live.`, data: t.slug };
  });
}

/** Everything Wally holds for a business, as one JSON file (offboarding, data requests). */
export async function exportBusinessData(tenantId: string) {
  return wrap(async () => {
    const { session, store, tenant, actor } = await ctx(tenantId);
    if (!session.isPlatformAdmin) return { ok: false, error: "Only the Wally team can export a business's data." };
    const [agents, knowledge, channels, contracts, approvals, outcomes, audit, conversations] = await Promise.all([
      store.listAgents(tenant.id),
      store.listKnowledge(tenant.id),
      store.listChannels(tenant.id),
      store.listContracts(tenant.id),
      store.listApprovals(tenant.id),
      store.listOutcomes(tenant.id, 10_000),
      store.listAudit(tenant.id, 10_000),
      store.listConversations(tenant.id, 10_000),
    ]);
    const withMessages = await Promise.all(conversations.map(async (c) => ({ ...c, messages: await store.listMessages(tenant.id, c.id) })));
    await store.audit(tenant.id, { actorType: "user", actor, action: "business.exported", detail: { conversations: conversations.length } });
    return {
      ok: true,
      message: "Export ready.",
      data: JSON.stringify({ exportedAt: new Date().toISOString(), business: tenant, agents, knowledge, channels, contracts, approvals, outcomes, conversations: withMessages, audit }, null, 2),
    };
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

/* -------------------------------------------------------------- connectors */

type ConnectorInput = Omit<Connector, "id" | "tenantId" | "createdAt"> & { id?: string; token?: string };

export async function saveConnector(tenantId: string, input: ConnectorInput) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    const { token, ...c } = input;
    let url: URL;
    try {
      url = new URL(c.url.trim());
    } catch {
      return { ok: false, error: "Enter the connector's full URL, starting with https://" };
    }
    if (url.protocol !== "https:" && url.hostname !== "localhost") return { ok: false, error: "Connectors must use https://" };
    if (!c.name.trim()) return { ok: false, error: "Give the connector a name." };
    const saved = await store.saveConnector(tenant.id, { ...c, name: c.name.trim(), url: url.toString() });
    // The token is a secret: it lives in settings, never on the connector row.
    if (c.auth === "bearer" && token?.trim()) await systemStore().setSetting(tenant.id, tokenKey(saved.id), token.trim(), true);
    await store.audit(tenant.id, { actorType: "user", actor, action: "connector.saved", detail: { name: saved.name, url: saved.url, agents: saved.agentIds.length } });
    return { ok: true, message: "Connector saved.", data: saved.id };
  });
}

export async function deleteConnector(tenantId: string, id: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    await store.deleteConnector(tenant.id, id);
    await systemStore().deleteSetting(tenant.id, tokenKey(id));
    await store.audit(tenant.id, { actorType: "user", actor, action: "connector.deleted", detail: { id } });
  });
}

/** Connects, lists the tools, and says which ones the AI staff will see. */
export async function testConnector(tenantId: string, id: string) {
  return wrap(async () => {
    const { store, tenant } = await ctx(tenantId);
    const c = (await store.listConnectors(tenant.id)).find((x) => x.id === id);
    if (!c) return { ok: false, error: "Connector not found." };
    const tools = await listConnectorTools(c, true);
    return { ok: true, message: `Connected: ${tools.length} tool${tools.length === 1 ? "" : "s"}.`, data: tools.map((t) => ({ name: t.name, description: t.description ?? "", readOnly: Boolean(t.annotations?.readOnlyHint) })) };
  });
}

export async function deleteChannel(tenantId: string, id: string) {
  return wrap(async () => {
    const { store, tenant } = await ctx(tenantId);
    await store.deleteChannel(tenant.id, id);
  });
}

/* --------------------------------------------------------------- contracts */
// Customer prices. Only the Wally team (platform admins) sets them; the
// business sees its own agreement read-only.

export async function saveContract(tenantId: string, input: Omit<Contract, "id" | "tenantId" | "createdAt"> & { id?: string }) {
  return wrap(async () => {
    const { session, store, tenant, actor } = await ctx(tenantId);
    if (!session.isPlatformAdmin) return { ok: false, error: "Only the Wally team can change prices." };
    if (!input.planName.trim()) return { ok: false, error: "Give the plan a name." };
    const nums = [input.monthlyFee, input.includedConversations, input.overageRate, input.setupFee];
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return { ok: false, error: "Prices and allowances can't be negative." };
    if (input.endsOn && input.endsOn < input.startsOn) return { ok: false, error: "The end date is before the start date." };
    const saved = await store.saveContract(tenant.id, {
      ...input,
      planName: input.planName.trim(),
      currency: input.currency.trim().toUpperCase() || "USD",
      includedConversations: Math.round(input.includedConversations),
      notes: input.notes?.trim() || null,
    });
    await store.audit(tenant.id, {
      actorType: "user",
      actor,
      action: input.id ? "contract.updated" : "contract.created",
      detail: { contractId: saved.id, plan: saved.planName, monthlyFee: saved.monthlyFee, currency: saved.currency },
    });
    return { ok: true, message: `${saved.planName} saved.` };
  });
}

export async function deleteContract(tenantId: string, id: string) {
  return wrap(async () => {
    const { session, store, tenant, actor } = await ctx(tenantId);
    if (!session.isPlatformAdmin) return { ok: false, error: "Only the Wally team can change prices." };
    await store.deleteContract(tenant.id, id);
    await store.audit(tenant.id, { actorType: "user", actor, action: "contract.removed", detail: { contractId: id } });
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
