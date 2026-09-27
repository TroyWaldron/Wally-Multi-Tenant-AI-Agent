import { redactDeep } from "@/lib/pii";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLE_LIBRARY } from "@/lib/roles";
import { serviceClient } from "@/lib/supabase";
import { assertTenant, type Store } from "@/lib/store/types";
import type {
  Agency,
  AgencyInvite,
  AgentTask,
  Agent,
  AgentVersion,
  Approval,
  AuditEntry,
  Channel,
  Connector,
  Contract,
  Conversation,
  KnowledgeDoc,
  Message,
  OutcomeEvent,
  RoleTemplate,
  Tenant,
  UsageEvent,
} from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const tenant = (r: Row): Tenant => ({
  id: r.id,
  agencyId: r.agency_id,
  name: r.name,
  slug: r.slug,
  industry: r.industry,
  country: r.country,
  timezone: r.timezone,
  currency: r.currency,
  status: r.status,
  publicKey: r.public_key,
  profile: r.profile ?? {},
  branding: r.branding ?? {},
  createdAt: r.created_at,
});

const agent = (r: Row): Agent => ({
  id: r.id,
  tenantId: r.tenant_id,
  templateKey: r.template_key,
  name: r.name,
  title: r.title,
  avatar: r.avatar,
  status: r.status,
  model: r.model,
  fallbackModel: r.fallback_model,
  effort: r.effort,
  instructions: r.instructions,
  personality: r.personality,
  boundaries: r.boundaries,
  channels: r.channels ?? [],
  voice: r.voice ?? {},
  monthlyBudgetUsd: Number(r.monthly_budget_usd),
  experiment: r.experiment ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const connector = (r: Row): Connector => ({
  id: r.id,
  tenantId: r.tenant_id,
  name: r.name,
  url: r.url,
  auth: r.auth,
  agentIds: r.agent_ids ?? [],
  allowedTools: r.allowed_tools ?? [],
  approvalTools: r.approval_tools ?? [],
  enabled: r.enabled,
  createdAt: r.created_at,
});

const contract = (r: Row): Contract => ({
  id: r.id,
  tenantId: r.tenant_id,
  agentId: r.agent_id,
  planName: r.plan_name,
  currency: r.currency,
  monthlyFee: Number(r.monthly_fee),
  includedConversations: Number(r.included_conversations),
  overageRate: Number(r.overage_rate),
  setupFee: Number(r.setup_fee),
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at,
});

const channel = (r: Row): Channel => ({
  id: r.id,
  tenantId: r.tenant_id,
  agentId: r.agent_id,
  kind: r.kind,
  externalId: r.external_id,
  label: r.label,
  active: r.active,
});

const conversation = (r: Row): Conversation => ({
  id: r.id,
  tenantId: r.tenant_id,
  agentId: r.agent_id,
  channel: r.channel,
  contact: r.contact ?? {},
  status: r.status,
  variant: r.variant ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const agentVersion = (r: Row): AgentVersion => ({ id: r.id, tenantId: r.tenant_id, agentId: r.agent_id, snapshot: r.snapshot, note: r.note, createdBy: r.created_by, createdAt: r.created_at });

const message = (r: Row): Message => ({
  id: r.id,
  tenantId: r.tenant_id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  meta: r.meta ?? {},
  createdAt: r.created_at,
});

const approval = (r: Row): Approval => ({
  id: r.id,
  tenantId: r.tenant_id,
  agentId: r.agent_id,
  conversationId: r.conversation_id,
  kind: r.kind,
  action: r.action,
  summary: r.summary,
  payload: r.payload ?? {},
  status: r.status,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
});

const auditEntry = (r: Row): AuditEntry => ({
  id: r.id,
  tenantId: r.tenant_id,
  actorType: r.actor_type,
  actor: r.actor,
  action: r.action,
  detail: r.detail ?? {},
  createdAt: r.created_at,
});

const outcome = (r: Row): OutcomeEvent => ({
  id: r.id,
  tenantId: r.tenant_id,
  agentId: r.agent_id,
  kind: r.kind,
  value: Number(r.value),
  currency: r.currency,
  note: r.note,
  createdAt: r.created_at,
});

const usage = (r: Row): UsageEvent => ({
  id: r.id,
  tenantId: r.tenant_id,
  agentId: r.agent_id,
  kind: r.kind,
  model: r.model,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  minutes: Number(r.minutes),
  costUsd: Number(r.cost_usd),
  createdAt: r.created_at,
});

const doc = (r: Row): KnowledgeDoc => ({
  id: r.id,
  tenantId: r.tenant_id,
  title: r.title,
  source: r.source,
  content: r.content,
  createdAt: r.created_at,
});

const template = (r: Row): RoleTemplate => ({
  id: r.id,
  tenantId: r.tenant_id,
  key: r.key,
  name: r.name,
  category: r.category,
  summary: r.summary,
  systemPrompt: r.system_prompt,
  defaultBoundaries: r.default_boundaries,
  defaultPersonality: r.default_personality,
  voiceEnabled: r.voice_enabled,
  version: r.version,
});

const agency = (r: Row): Agency => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  marginPct: Number(r.margin_pct ?? 0),
  supportEmail: r.support_email ?? null,
  branding: r.branding ?? {},
});

function agencyPatch(p: Partial<Agency>): Row {
  const out: Row = {};
  if (p.name !== undefined) out.name = p.name;
  if (p.slug !== undefined) out.slug = p.slug;
  if (p.marginPct !== undefined) out.margin_pct = p.marginPct;
  if (p.supportEmail !== undefined) out.support_email = p.supportEmail;
  if (p.branding !== undefined) out.branding = p.branding;
  return out;
}

const task = (r: Row): AgentTask => ({
  id: r.id,
  tenantId: r.tenant_id,
  agentId: r.agent_id,
  conversationId: r.conversation_id,
  title: r.title,
  detail: r.detail,
  assignee: r.assignee,
  dueAt: r.due_at,
  status: r.status,
  chaseCount: r.chase_count,
  lastChasedAt: r.last_chased_at,
  doneAt: r.done_at,
  doneNote: r.done_note,
  createdAt: r.created_at,
});

function tenantPatch(p: Partial<Tenant>): Row {
  const out: Row = {};
  if (p.name !== undefined) out.name = p.name;
  if (p.slug !== undefined) out.slug = p.slug;
  if (p.agencyId !== undefined) out.agency_id = p.agencyId;
  if (p.industry !== undefined) out.industry = p.industry;
  if (p.country !== undefined) out.country = p.country;
  if (p.timezone !== undefined) out.timezone = p.timezone;
  if (p.currency !== undefined) out.currency = p.currency;
  if (p.status !== undefined) out.status = p.status;
  if (p.profile !== undefined) out.profile = p.profile;
  if (p.branding !== undefined) out.branding = p.branding;
  return out;
}

// The client is untyped (no generated DB types yet), so rows are `any` here
// and the mappers above give them shape.
function must(res: { data: any; error: { message: string } | null }): any {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export function supabaseStore(db: SupabaseClient): Store {
  return {
    mode: "supabase",

    async listTenants() {
      return must(await db.from("tenants").select("*").order("name")).map(tenant);
    },
    async getTenant(id) {
      const r = must(await db.from("tenants").select("*").eq("id", id).maybeSingle());
      return r ? tenant(r) : null;
    },
    async getTenantByPublicKey(key) {
      const r = must(await db.from("tenants").select("*").eq("public_key", key).maybeSingle());
      return r ? tenant(r) : null;
    },
    async getTenantBySlug(slug) {
      const r = must(await db.from("tenants").select("*").eq("slug", slug).maybeSingle());
      return r ? tenant(r) : null;
    },
    async createTenant(input) {
      return tenant(must(await db.from("tenants").insert(tenantPatch(input)).select("*").single()));
    },
    async updateTenant(id, patch) {
      must(await db.from("tenants").update(tenantPatch(patch)).eq("id", id));
    },

    async listTasks(tenantId, status) {
      assertTenant(tenantId);
      let q = db.from("agent_tasks").select("*").eq("tenant_id", tenantId);
      if (status) q = q.eq("status", status);
      return must(await q.order("due_at").limit(200)).map(task);
    },
    async createTask(tenantId, t) {
      assertTenant(tenantId);
      const row = { tenant_id: tenantId, agent_id: t.agentId, conversation_id: t.conversationId, title: t.title, detail: t.detail, assignee: t.assignee, due_at: t.dueAt };
      return task(must(await db.from("agent_tasks").insert(row).select("*").single()));
    },
    async updateTask(tenantId, id, patch) {
      assertTenant(tenantId);
      const row: Row = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.chaseCount !== undefined) row.chase_count = patch.chaseCount;
      if (patch.lastChasedAt !== undefined) row.last_chased_at = patch.lastChasedAt;
      if (patch.doneAt !== undefined) row.done_at = patch.doneAt;
      if (patch.doneNote !== undefined) row.done_note = patch.doneNote;
      if (patch.dueAt !== undefined) row.due_at = patch.dueAt;
      must(await db.from("agent_tasks").update(row).eq("tenant_id", tenantId).eq("id", id));
    },

    async listAgencies() {
      return must(await db.from("agencies").select("*").order("name")).map(agency);
    },
    async getAgency(id) {
      const r = must(await db.from("agencies").select("*").eq("id", id).maybeSingle());
      return r ? agency(r) : null;
    },
    async createAgency(input) {
      return agency(must(await db.from("agencies").insert(agencyPatch(input)).select("*").single()));
    },
    async updateAgency(id, patch) {
      must(await db.from("agencies").update(agencyPatch(patch)).eq("id", id));
    },
    async listAgencyInvites(agencyId) {
      const rows = must(await db.from("agency_invites").select("*").eq("agency_id", agencyId).order("created_at"));
      return rows.map((r: Row): AgencyInvite => ({ id: r.id, agencyId: r.agency_id, email: r.email, invitedBy: r.invited_by, createdAt: r.created_at }));
    },
    async addAgencyInvite(agencyId, email, invitedBy) {
      must(await db.from("agency_invites").upsert({ agency_id: agencyId, email, invited_by: invitedBy }, { onConflict: "agency_id,email" }));
    },
    async deleteAgencyInvite(agencyId, id) {
      must(await db.from("agency_invites").delete().eq("agency_id", agencyId).eq("id", id));
    },

    async listTemplates(tenantId) {
      assertTenant(tenantId);
      const custom = must(await db.from("role_templates").select("*").eq("tenant_id", tenantId)).map(template);
      return [...ROLE_LIBRARY, ...custom];
    },

    async listAgents(tenantId) {
      assertTenant(tenantId);
      return must(await db.from("agents").select("*").eq("tenant_id", tenantId).order("created_at")).map(agent);
    },
    async getAgent(tenantId, id) {
      assertTenant(tenantId);
      const r = must(await db.from("agents").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle());
      return r ? agent(r) : null;
    },
    async saveAgent(tenantId, a) {
      assertTenant(tenantId);
      const row: Row = {
        tenant_id: tenantId,
        template_key: a.templateKey,
        name: a.name,
        title: a.title,
        avatar: a.avatar,
        status: a.status,
        model: a.model,
        fallback_model: a.fallbackModel,
        effort: a.effort,
        instructions: a.instructions,
        personality: a.personality,
        boundaries: a.boundaries,
        channels: a.channels,
        voice: a.voice,
        monthly_budget_usd: a.monthlyBudgetUsd,
        ...(a.experiment !== undefined ? { experiment: a.experiment } : {}),
        updated_at: new Date().toISOString(),
      };
      if (a.id) {
        return agent(must(await db.from("agents").update(row).eq("tenant_id", tenantId).eq("id", a.id).select("*").single()));
      }
      return agent(must(await db.from("agents").insert(row).select("*").single()));
    },
    async deleteAgent(tenantId, id) {
      assertTenant(tenantId);
      must(await db.from("agents").delete().eq("tenant_id", tenantId).eq("id", id));
    },

    async listAgentVersions(tenantId, agentId) {
      assertTenant(tenantId);
      return must(await db.from("agent_versions").select("*").eq("tenant_id", tenantId).eq("agent_id", agentId).order("created_at", { ascending: false }).limit(30)).map(agentVersion);
    },
    async addAgentVersion(tenantId, v) {
      assertTenant(tenantId);
      return agentVersion(must(await db.from("agent_versions").insert({ tenant_id: tenantId, agent_id: v.agentId, snapshot: v.snapshot, note: v.note, created_by: v.createdBy }).select("*").single()));
    },

    async listChannels(tenantId) {
      assertTenant(tenantId);
      return must(await db.from("channels").select("*").eq("tenant_id", tenantId)).map(channel);
    },
    async saveChannel(tenantId, c) {
      assertTenant(tenantId);
      const row = { tenant_id: tenantId, agent_id: c.agentId, kind: c.kind, external_id: c.externalId, label: c.label, active: c.active };
      if (c.id) return channel(must(await db.from("channels").update(row).eq("tenant_id", tenantId).eq("id", c.id).select("*").single()));
      return channel(must(await db.from("channels").insert(row).select("*").single()));
    },
    async deleteChannel(tenantId, id) {
      assertTenant(tenantId);
      must(await db.from("channels").delete().eq("tenant_id", tenantId).eq("id", id));
    },
    async findChannel(kind, externalId) {
      const r = must(await db.from("channels").select("*").eq("kind", kind).eq("external_id", externalId).eq("active", true).maybeSingle());
      return r ? channel(r) : null;
    },

    async listConnectors(tenantId) {
      assertTenant(tenantId);
      return must(await db.from("connectors").select("*").eq("tenant_id", tenantId).order("created_at")).map(connector);
    },
    async saveConnector(tenantId, c) {
      assertTenant(tenantId);
      const row = { tenant_id: tenantId, name: c.name, url: c.url, auth: c.auth, agent_ids: c.agentIds, allowed_tools: c.allowedTools, approval_tools: c.approvalTools, enabled: c.enabled };
      if (c.id) return connector(must(await db.from("connectors").update(row).eq("tenant_id", tenantId).eq("id", c.id).select("*").single()));
      return connector(must(await db.from("connectors").insert(row).select("*").single()));
    },
    async deleteConnector(tenantId, id) {
      assertTenant(tenantId);
      must(await db.from("connectors").delete().eq("tenant_id", tenantId).eq("id", id));
    },

    async listContracts(tenantId) {
      assertTenant(tenantId);
      return must(await db.from("contracts").select("*").eq("tenant_id", tenantId).order("created_at")).map(contract);
    },
    async saveContract(tenantId, c) {
      assertTenant(tenantId);
      const row = {
        tenant_id: tenantId,
        agent_id: c.agentId,
        plan_name: c.planName,
        currency: c.currency,
        monthly_fee: c.monthlyFee,
        included_conversations: c.includedConversations,
        overage_rate: c.overageRate,
        setup_fee: c.setupFee,
        starts_on: c.startsOn,
        ends_on: c.endsOn,
        status: c.status,
        notes: c.notes,
        updated_at: new Date().toISOString(),
      };
      if (c.id) return contract(must(await db.from("contracts").update(row).eq("tenant_id", tenantId).eq("id", c.id).select("*").single()));
      return contract(must(await db.from("contracts").insert(row).select("*").single()));
    },
    async deleteContract(tenantId, id) {
      assertTenant(tenantId);
      must(await db.from("contracts").delete().eq("tenant_id", tenantId).eq("id", id));
    },

    async listConversations(tenantId, limit = 50) {
      assertTenant(tenantId);
      return must(await db.from("conversations").select("*").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(limit)).map(conversation);
    },
    async listConversationsSince(tenantId, sinceIso) {
      assertTenant(tenantId);
      // Paged: the API returns at most 1,000 rows per request.
      const rows: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const page = must(
          await db.from("conversations").select("id, agent_id, channel, status, created_at, variant").eq("tenant_id", tenantId).gte("created_at", sinceIso).order("created_at").range(from, from + 999)
        );
        rows.push(...page);
        if (page.length < 1000) break;
      }
      return rows.map((r: Row) => ({ id: r.id, agentId: r.agent_id, channel: r.channel, status: r.status, createdAt: r.created_at, variant: r.variant ?? null }));
    },
    async getConversation(tenantId, id) {
      assertTenant(tenantId);
      const r = must(await db.from("conversations").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle());
      return r ? conversation(r) : null;
    },
    async findOpenConversation(tenantId, ch, contactKey) {
      assertTenant(tenantId);
      // Quoted so a phone or email can't inject extra PostgREST filters.
      const key = `"${contactKey.replace(/["\\]/g, "")}"`;
      const rows = must(
        await db
          .from("conversations")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("channel", ch)
          .neq("status", "closed")
          .or(`contact->>phone.eq.${key},contact->>email.eq.${key}`)
          .order("updated_at", { ascending: false })
          .limit(1)
      );
      return rows[0] ? conversation(rows[0]) : null;
    },
    async createConversation(tenantId, c) {
      assertTenant(tenantId);
      return conversation(must(await db.from("conversations").insert({ tenant_id: tenantId, agent_id: c.agentId, channel: c.channel, contact: c.contact, variant: c.variant ?? null }).select("*").single()));
    },
    async setConversationStatus(tenantId, id, status) {
      assertTenant(tenantId);
      must(await db.from("conversations").update({ status, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id));
    },
    async listMessages(tenantId, conversationId) {
      assertTenant(tenantId);
      return must(await db.from("messages").select("*").eq("tenant_id", tenantId).eq("conversation_id", conversationId).order("id")).map(message);
    },
    async addMessage(tenantId, m) {
      assertTenant(tenantId);
      const row = must(
        await db.from("messages").insert({ tenant_id: tenantId, conversation_id: m.conversationId, role: m.role, content: m.content, meta: m.meta ?? {} }).select("*").single()
      );
      await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", m.conversationId);
      return message(row);
    },

    async listApprovals(tenantId) {
      assertTenant(tenantId);
      return must(await db.from("approvals").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200)).map(approval);
    },
    async createApproval(tenantId, a) {
      assertTenant(tenantId);
      return approval(
        must(
          await db
            .from("approvals")
            .insert({ tenant_id: tenantId, agent_id: a.agentId, conversation_id: a.conversationId, kind: a.kind, action: a.action, summary: a.summary, payload: a.payload })
            .select("*")
            .single()
        )
      );
    },
    async decideApproval(tenantId, id, status, by) {
      assertTenant(tenantId);
      const r = must(
        await db
          .from("approvals")
          .update({ status, decided_by: by, decided_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("id", id)
          .eq("status", "pending")
          .select("*")
          .maybeSingle()
      );
      return r ? approval(r) : null;
    },

    async listAudit(tenantId, limit = 100) {
      assertTenant(tenantId);
      return must(await db.from("audit_log").select("*").eq("tenant_id", tenantId).order("id", { ascending: false }).limit(limit)).map(auditEntry);
    },
    async audit(tenantId, e) {
      assertTenant(tenantId);
      must(await db.from("audit_log").insert({ tenant_id: tenantId, actor_type: e.actorType, actor: e.actor, action: e.action, detail: redactDeep(e.detail ?? {}) }));
    },

    async listOutcomes(tenantId, limit = 200) {
      assertTenant(tenantId);
      return must(await db.from("outcome_events").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit)).map(outcome);
    },
    async recordOutcome(tenantId, o) {
      assertTenant(tenantId);
      must(await db.from("outcome_events").insert({ tenant_id: tenantId, agent_id: o.agentId, kind: o.kind, value: o.value, note: o.note, currency: o.currency ?? "TTD" }));
    },
    async listUsage(tenantId, sinceIso) {
      assertTenant(tenantId);
      return must(await db.from("usage_events").select("*").eq("tenant_id", tenantId).gte("created_at", sinceIso).order("created_at")).map(usage);
    },
    async recordUsage(tenantId, u) {
      assertTenant(tenantId);
      must(
        await db.from("usage_events").insert({
          tenant_id: tenantId,
          agent_id: u.agentId,
          kind: u.kind,
          model: u.model,
          input_tokens: u.inputTokens,
          output_tokens: u.outputTokens,
          minutes: u.minutes,
          cost_usd: u.costUsd,
        })
      );
    },

    async listKnowledge(tenantId) {
      assertTenant(tenantId);
      return must(await db.from("knowledge_docs").select("id,tenant_id,title,source,content,created_at").eq("tenant_id", tenantId).order("created_at")).map(doc);
    },
    async addKnowledge(tenantId, d) {
      assertTenant(tenantId);
      return doc(must(await db.from("knowledge_docs").insert({ tenant_id: tenantId, ...d }).select("id,tenant_id,title,source,content,created_at").single()));
    },
    async deleteKnowledge(tenantId, id) {
      assertTenant(tenantId);
      must(await db.from("knowledge_docs").delete().eq("tenant_id", tenantId).eq("id", id));
    },
    async searchKnowledge(tenantId, query, limit = 4) {
      assertTenant(tenantId);
      // websearch_to_tsquery ANDs terms; retry with OR so a chatty question still finds matches.
      const strict = must(await db.rpc("search_knowledge", { p_tenant: tenantId, p_query: query, p_limit: limit })) as Row[];
      if (strict.length) return strict.map((r) => ({ id: r.id, title: r.title, content: r.content }));
      const loose = query.split(/\W+/).filter((w) => w.length > 2).join(" or ");
      if (!loose) return [];
      const rows = must(await db.rpc("search_knowledge", { p_tenant: tenantId, p_query: loose, p_limit: limit })) as Row[];
      return rows.map((r) => ({ id: r.id, title: r.title, content: r.content }));
    },

    async matchKnowledge(tenantId, embedding, limit = 4) {
      assertTenant(tenantId);
      const rows = must(await db.rpc("match_knowledge", { p_tenant: tenantId, p_embedding: JSON.stringify(embedding), p_limit: limit })) as Row[];
      return rows.map((r) => ({ id: r.id, title: r.title, content: r.content, similarity: Number(r.similarity) }));
    },
    async listUnembeddedKnowledge(tenantId, limit) {
      assertTenant(tenantId);
      return must(await db.from("knowledge_docs").select("id,title,content").eq("tenant_id", tenantId).is("embedding", null).limit(limit)) as Row[] as { id: string; title: string; content: string }[];
    },
    async setKnowledgeEmbedding(tenantId, id, embedding) {
      assertTenant(tenantId);
      must(await db.from("knowledge_docs").update({ embedding: JSON.stringify(embedding) }).eq("tenant_id", tenantId).eq("id", id));
    },

    // Settings hold secrets, so they always go through the service role.
    async getSettings(tenantId) {
      const q = serviceClient().from("settings").select("key,value,secret");
      const rows = must(await (tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null)));
      return rows as { key: string; value: string; secret: boolean }[];
    },
    async setSetting(tenantId, key, value, secret) {
      must(
        await serviceClient()
          .from("settings")
          .upsert({ tenant_id: tenantId, key, value, secret, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,key" })
      );
    },
    async deleteSetting(tenantId, key) {
      const q = serviceClient().from("settings").delete().eq("key", key);
      must(await (tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null)));
    },
  };
}
