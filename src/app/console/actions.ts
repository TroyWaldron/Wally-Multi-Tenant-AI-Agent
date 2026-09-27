"use server";

// Console mutations. Each one re-checks the session and uses the signed-in
// user's RLS-scoped store, so the database decides what they may change.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { runScenarios } from "@/lib/scenarioRunner";
import { sendEvent } from "@/lib/n8n";
import { getRole } from "@/lib/roles";
import { suggestedPlan } from "@/lib/billing";
import { STARTER_AGENCY, STARTER_AGENTS, STARTER_KNOWLEDGE, STARTER_TENANT } from "@/lib/seed/starter";
import { getSession, systemStore } from "@/lib/session";
import { SETTING_DEFS } from "@/lib/settings";
import { sendStaffReply } from "@/lib/staffReply";
import { helpdeskFromWally, isHelpdesk } from "@/lib/helpdesk";
import { syncKnowledge } from "@/lib/knowledgeSync";
import { isSupabaseConfigured, serviceClient } from "@/lib/supabase";
import { decide } from "@/lib/approvals";
import { embedPending, searchKnowledge } from "@/lib/embeddings";
import { runHealthCheck as healthCheck } from "@/lib/health";
import { listConnectorTools, tokenKey } from "@/lib/mcp";
import { keepVersion, snapshotOf } from "@/lib/personas";
import type { Agency, Agent, Channel, Connector, Contract, Tenant } from "@/lib/types";

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
    // Experiments are started and stopped by their own actions, never by a form save.
    const { experiment: _experiment, ...fields } = input;
    void _experiment;
    const saved = await store.saveAgent(tenant.id, fields);
    await keepVersion(store, saved, actor);
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

/* ---------------------------------------------------- persona versions */

async function agentOf(store: Awaited<ReturnType<typeof ctx>>["store"], tenantId: string, agentId: string) {
  const agent = await store.getAgent(tenantId, agentId);
  if (!agent) throw new Error("Agent not found.");
  return agent;
}

export type VersionsView = {
  versions: { id: string; title: string | null; instructions: string; note: string | null; createdBy: string | null; createdAt: string; current: boolean }[];
  experiment: { versionId: string; share: number; startedAt: string; results: Record<"A" | "B", { chats: number; handedOver: number; leads: number }> } | null;
};

export async function loadVersions(tenantId: string, agentId: string) {
  return wrap(async () => {
    const { store, tenant } = await ctx(tenantId);
    const agent = await agentOf(store, tenant.id, agentId);
    const versions = await store.listAgentVersions(tenant.id, agent.id);
    const now = JSON.stringify(snapshotOf(agent));
    let experiment: VersionsView["experiment"] = null;
    if (agent.experiment) {
      const convs = (await store.listConversationsSince(tenant.id, agent.experiment.startedAt)).filter((c) => c.agentId === agent.id && c.variant);
      const approvals = await store.listApprovals(tenant.id);
      const handed = new Set(approvals.filter((a) => a.kind === "escalation" && a.conversationId).map((a) => a.conversationId));
      const leads = new Set((await store.listAudit(tenant.id, 1000)).filter((e) => e.action === "lead.captured").map((e) => e.detail.conversationId));
      const tally = (v: "A" | "B") => {
        const list = convs.filter((c) => c.variant === v);
        return { chats: list.length, handedOver: list.filter((c) => c.status === "waiting_human" || handed.has(c.id)).length, leads: list.filter((c) => leads.has(c.id)).length };
      };
      experiment = { ...agent.experiment, results: { A: tally("A"), B: tally("B") } };
    }
    const data: VersionsView = {
      versions: versions.map((v, i) => ({ id: v.id, title: v.snapshot.title, instructions: v.snapshot.instructions, note: v.note, createdBy: v.createdBy, createdAt: v.createdAt, current: i === 0 && JSON.stringify(snapshotOf(v.snapshot)) === now })),
      experiment,
    };
    return { ok: true, data };
  });
}

export async function restoreVersion(tenantId: string, agentId: string, versionId: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    const agent = await agentOf(store, tenant.id, agentId);
    const v = (await store.listAgentVersions(tenant.id, agent.id)).find((x) => x.id === versionId);
    if (!v) return { ok: false, error: "That version no longer exists." };
    const saved = await store.saveAgent(tenant.id, { ...agent, ...snapshotOf(v.snapshot), experiment: null });
    await keepVersion(store, saved, actor, `Restored the version from ${new Date(v.createdAt).toISOString().slice(0, 10)}`);
    await store.audit(tenant.id, { actorType: "user", actor, action: "agent.version_restored", detail: { agentId, versionId } });
    return { ok: true, message: `${agent.name} is back to that version.` };
  });
}

export async function startExperiment(tenantId: string, agentId: string, versionId: string, share: number) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    const agent = await agentOf(store, tenant.id, agentId);
    const pct = Math.round(Math.min(90, Math.max(10, share)));
    await store.saveAgent(tenant.id, { ...agent, experiment: { versionId, share: pct, startedAt: new Date().toISOString() } });
    await store.audit(tenant.id, { actorType: "user", actor, action: "agent.experiment_started", detail: { agentId, versionId, share: pct } });
    return { ok: true, message: `Testing: ${pct}% of new chats with ${agent.name} get the older version.` };
  });
}

export async function stopExperiment(tenantId: string, agentId: string, keep: "A" | "B") {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    const agent = await agentOf(store, tenant.id, agentId);
    if (!agent.experiment) return { ok: false, error: "No test is running." };
    const v = keep === "B" ? (await store.listAgentVersions(tenant.id, agent.id)).find((x) => x.id === agent.experiment?.versionId) : undefined;
    const saved = await store.saveAgent(tenant.id, { ...agent, ...(v ? snapshotOf(v.snapshot) : {}), experiment: null });
    if (v) await keepVersion(store, saved, actor, "Kept the winning version of an A/B test");
    await store.audit(tenant.id, { actorType: "user", actor, action: "agent.experiment_stopped", detail: { agentId, kept: keep } });
    return { ok: true, message: keep === "B" ? `${agent.name} now uses the version that won.` : `${agent.name} keeps its current persona.` };
  });
}

/* --------------------------------------------------------------- approvals */

export async function decideApproval(tenantId: string, approvalId: string, decision: "approved" | "rejected", lesson?: string) {
  return wrap(async () => {
    const { store, tenant, actor } = await ctx(tenantId);
    return decide(store, tenant, approvalId, decision, actor, lesson);
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
    after(() => embedPending(systemStore(), tenant).catch((err) => console.error("embedding failed", err)));
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
  return searchKnowledge(store, tenant, query);
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
  /** The agency that owns this client; agency admins always onboard under their own. */
  agencyId?: string | null;
};

/**
 * Onboarding in one step: the business, its first AI staff (as drafts to
 * test before going live), its knowledge, and agreements at the
 * introductory price for each role.
 */
export async function onboardBusiness(input: OnboardInput) {
  return wrap(async () => {
    const session = await getSession();
    if (!session || (!session.isPlatformAdmin && !session.agencyIds.length)) return { ok: false, error: "Only the Wally team or an agency admin can add a business." };
    const name = input.name.trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    if (!slug) return { ok: false, error: "Enter a business name." };
    const agencyId = session.isPlatformAdmin ? input.agencyId || null : session.agencyIds.includes(input.agencyId ?? "") ? input.agencyId! : session.agencyIds[0];
    const { store } = session;
    const t = await store.createTenant({ name, slug, agencyId });
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

/** Settings > Health check: tests every channel, key, workflow and agent. */
export async function runHealthCheck(tenantId: string) {
  return wrap(async () => {
    const { store, tenant } = await ctx(tenantId);
    const items = await healthCheck(store, tenant);
    const fails = items.filter((i) => i.status === "fail").length;
    return { ok: true, message: fails ? `${fails} thing${fails > 1 ? "s" : ""} need${fails > 1 ? "" : "s"} fixing.` : "Everything checked out.", data: items };
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

/* ---------------------------------------------------------------- agencies */

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export async function createAgency(name: string) {
  return wrap(async () => {
    const session = await getSession();
    if (!session?.isPlatformAdmin) return { ok: false, error: "Only the Wally team can add an agency." };
    const slug = slugOf(name);
    if (!slug) return { ok: false, error: "Enter the agency's name." };
    await session.store.createAgency({ name: name.trim(), slug });
    return { ok: true, message: `${name.trim()} added.` };
  });
}

/**
 * The Wally team sets everything, margin included. An agency's own admins
 * may change only their branding and support email.
 */
export async function saveAgency(agencyId: string, patch: Pick<Agency, "name" | "supportEmail" | "branding" | "marginPct">) {
  return wrap(async () => {
    const session = await getSession();
    if (!session) throw new Error("Your session expired. Sign in again.");
    const clean = { ...patch, marginPct: Math.min(90, Math.max(0, Number(patch.marginPct) || 0)), supportEmail: patch.supportEmail?.trim() || null };
    if (session.isPlatformAdmin) {
      await session.store.updateAgency(agencyId, clean);
    } else if (session.agencyIds.includes(agencyId)) {
      await systemStore().updateAgency(agencyId, { branding: clean.branding, supportEmail: clean.supportEmail });
    } else {
      return { ok: false, error: "You don't manage that agency." };
    }
    return { ok: true, message: "Agency saved." };
  });
}

export async function inviteAgencyAdmin(agencyId: string, email: string) {
  return wrap(async () => {
    const session = await getSession();
    if (!session?.isPlatformAdmin) return { ok: false, error: "Only the Wally team can add agency admins." };
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: "Enter a valid email address." };
    await session.store.addAgencyInvite(agencyId, e, session.user.email);
    return { ok: true, message: `${e} becomes an admin the first time they sign in to Wally.` };
  });
}

export async function removeAgencyInvite(agencyId: string, inviteId: string) {
  return wrap(async () => {
    const session = await getSession();
    if (!session?.isPlatformAdmin) return { ok: false, error: "Only the Wally team can change agency admins." };
    await session.store.deleteAgencyInvite(agencyId, inviteId);
  });
}
