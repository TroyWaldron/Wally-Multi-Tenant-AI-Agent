// Demo store: everything in memory, seeded with Sunsational Tobago. Lets you
// click through the whole console before a Supabase project exists. Data
// resets when the server restarts (and isn't shared between Vercel function
// instances), so use it for local testing only.
import { redactDeep } from "@/lib/pii";
import { randomUUID } from "node:crypto";
import { ROLE_LIBRARY } from "@/lib/roles";
import { STARTER_AGENTS, STARTER_KNOWLEDGE, STARTER_TENANT } from "@/lib/seed/starter";
import { assertTenant, type Store } from "@/lib/store/types";
import type {
  Agent,
  Approval,
  AuditEntry,
  Channel,
  Connector,
  Contract,
  Conversation,
  KnowledgeDoc,
  Message,
  OutcomeEvent,
  SettingRow,
  Tenant,
  UsageEvent,
} from "@/lib/types";

type Db = {
  tenants: Tenant[];
  agents: Agent[];
  channels: Channel[];
  contracts: Contract[];
  connectors: Connector[];
  conversations: Conversation[];
  messages: Message[];
  approvals: Approval[];
  audit: AuditEntry[];
  outcomes: OutcomeEvent[];
  usage: UsageEvent[];
  knowledge: KnowledgeDoc[];
  settings: (SettingRow & { tenantId: string | null })[];
  seq: number;
};

const now = () => new Date().toISOString();
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function seed(): Db {
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const db: Db = {
    tenants: [
      {
        id: tenantId,
        agencyId: "novate",
        country: "TT",
        timezone: "America/Port_of_Spain",
        currency: "TTD",
        status: "trial",
        industry: null,
        publicKey: "wk_demo_sunsational",
        profile: {},
        branding: {},
        createdAt: ago(3),
        ...STARTER_TENANT,
      } as Tenant,
    ],
    agents: [],
    channels: [],
    contracts: [],
    connectors: [],
    conversations: [],
    messages: [],
    approvals: [],
    audit: [],
    outcomes: [],
    usage: [],
    knowledge: [],
    settings: [],
    seq: 1,
  };
  db.agents = STARTER_AGENTS.map((a, i) => ({ ...a, id: `agent-${i + 1}`, tenantId, createdAt: ago(3), updatedAt: ago(1) }));
  db.knowledge = STARTER_KNOWLEDGE.map((k, i) => ({ ...k, id: `kb-${i + 1}`, tenantId, createdAt: ago(3) }));
  db.channels = [{ id: "ch-1", tenantId, agentId: "agent-1", kind: "web", externalId: "sunsationaltobago.com", label: "Website widget", active: true }];

  // A little history so the dashboard isn't empty. Marked as sample data in the UI.
  const conv: Conversation = {
    id: "conv-1",
    tenantId,
    agentId: "agent-1",
    channel: "whatsapp",
    contact: { name: "Sample guest", phone: "+1 555 0100" },
    status: "waiting_human",
    createdAt: ago(1),
    updatedAt: ago(1),
  };
  db.conversations.push(conv);
  const msgs: [Message["role"], string][] = [
    ["user", "Hi! Is Sugar Haven Villa 1 free 12-16 December for 8 people?"],
    ["assistant", "Hi, I'm Sunny from Sunsational Tobago. Villa 1 sleeps up to 8 at TT$1,600 a night. Let me check those dates for you."],
    ["user", "Great. Could you do a discount for 4 nights?"],
    ["assistant", "I've asked the team about a discount for your 4-night stay and they'll reply here shortly."],
  ];
  for (const [role, content] of msgs) {
    db.messages.push({ id: db.seq++, tenantId, conversationId: conv.id, role, content, meta: { sample: true }, createdAt: ago(1) });
  }
  db.approvals.push({
    id: "appr-1",
    tenantId,
    agentId: "agent-1",
    conversationId: conv.id,
    kind: "action",
    action: "discount",
    summary: "Sample: guest asks for a discount on a 4-night stay at Sugar Haven Villa 1 (12-16 Dec, 8 guests).",
    payload: { villa: "sugar-haven-villa-1", nights: 4, requestedPct: 10 },
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    createdAt: ago(1),
  });
  const outcomes: [string, number, number][] = [
    ["lead", 0, 6],
    ["lead", 0, 5],
    ["booking", 6400, 4],
    ["lead", 0, 2],
    ["booking", 7200, 1],
  ];
  for (const [kind, value, d] of outcomes) {
    db.outcomes.push({ id: db.seq++, tenantId, agentId: "agent-1", kind, value, currency: "TTD", note: "Sample data", createdAt: ago(d) });
  }
  for (let d = 6; d >= 0; d--) {
    db.usage.push({ id: db.seq++, tenantId, agentId: "agent-1", kind: "llm", model: "claude-opus-5", inputTokens: 42000 + d * 3000, outputTokens: 6000 + d * 500, minutes: 0, costUsd: 0.36 + d * 0.03, createdAt: ago(d) });
  }
  db.audit.push({ id: db.seq++, tenantId, actorType: "system", actor: "wally", action: "tenant.seeded", detail: { note: "Demo data loaded" }, createdAt: ago(3) });
  return db;
}

const g = globalThis as unknown as { __wallyDemoDb?: Db };
function db(): Db {
  if (!g.__wallyDemoDb) g.__wallyDemoDb = seed();
  return g.__wallyDemoDb;
}

const byNewest = <T extends { createdAt: string }>(a: T, b: T) => (a.createdAt < b.createdAt ? 1 : -1);

export const memoryStore: Store = {
  mode: "demo",

  async listTenants() {
    return db().tenants;
  },
  async getTenant(id) {
    return db().tenants.find((t) => t.id === id) ?? null;
  },
  async getTenantByPublicKey(key) {
    return db().tenants.find((t) => t.publicKey === key) ?? null;
  },
  async getTenantBySlug(slug) {
    return db().tenants.find((t) => t.slug === slug) ?? null;
  },
  async createTenant(input) {
    const t: Tenant = {
      id: randomUUID(),
      agencyId: null,
      industry: null,
      country: "TT",
      timezone: "America/Port_of_Spain",
      currency: "TTD",
      status: "trial",
      publicKey: `wk_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      profile: {},
      branding: {},
      createdAt: now(),
      ...input,
    };
    db().tenants.push(t);
    return t;
  },
  async updateTenant(id, patch) {
    const t = db().tenants.find((x) => x.id === id);
    if (t) Object.assign(t, patch, { id: t.id, publicKey: t.publicKey });
  },

  async listTemplates(tenantId) {
    assertTenant(tenantId);
    return ROLE_LIBRARY;
  },

  async listAgents(tenantId) {
    assertTenant(tenantId);
    return db().agents.filter((a) => a.tenantId === tenantId);
  },
  async getAgent(tenantId, id) {
    assertTenant(tenantId);
    return db().agents.find((a) => a.tenantId === tenantId && a.id === id) ?? null;
  },
  async saveAgent(tenantId, input) {
    assertTenant(tenantId);
    const existing = input.id ? db().agents.find((a) => a.tenantId === tenantId && a.id === input.id) : undefined;
    if (existing) {
      Object.assign(existing, input, { tenantId, updatedAt: now() });
      return existing;
    }
    const agent: Agent = { ...input, id: randomUUID(), tenantId, createdAt: now(), updatedAt: now() };
    db().agents.push(agent);
    return agent;
  },
  async deleteAgent(tenantId, id) {
    assertTenant(tenantId);
    db().agents = db().agents.filter((a) => !(a.tenantId === tenantId && a.id === id));
  },

  async listChannels(tenantId) {
    assertTenant(tenantId);
    return db().channels.filter((c) => c.tenantId === tenantId);
  },
  async saveChannel(tenantId, input) {
    assertTenant(tenantId);
    const existing = input.id ? db().channels.find((c) => c.tenantId === tenantId && c.id === input.id) : undefined;
    if (existing) {
      Object.assign(existing, input, { tenantId });
      return existing;
    }
    const ch: Channel = { ...input, id: randomUUID(), tenantId };
    db().channels.push(ch);
    return ch;
  },
  async deleteChannel(tenantId, id) {
    assertTenant(tenantId);
    db().channels = db().channels.filter((c) => !(c.tenantId === tenantId && c.id === id));
  },
  async listConnectors(tenantId) {
    assertTenant(tenantId);
    return (db().connectors ??= []).filter((c) => c.tenantId === tenantId);
  },
  async saveConnector(tenantId, input) {
    assertTenant(tenantId);
    const list = (db().connectors ??= []);
    const existing = input.id ? list.find((c) => c.tenantId === tenantId && c.id === input.id) : undefined;
    if (existing) {
      Object.assign(existing, input, { tenantId });
      return existing;
    }
    const c: Connector = { ...input, id: randomUUID(), tenantId, createdAt: new Date().toISOString() };
    list.push(c);
    return c;
  },
  async deleteConnector(tenantId, id) {
    assertTenant(tenantId);
    db().connectors = (db().connectors ?? []).filter((c) => !(c.tenantId === tenantId && c.id === id));
  },
  async listContracts(tenantId) {
    assertTenant(tenantId);
    return db().contracts.filter((c) => c.tenantId === tenantId);
  },
  async saveContract(tenantId, input) {
    assertTenant(tenantId);
    const existing = input.id ? db().contracts.find((c) => c.tenantId === tenantId && c.id === input.id) : undefined;
    if (existing) {
      Object.assign(existing, input, { tenantId });
      return existing;
    }
    const c: Contract = { ...input, id: randomUUID(), tenantId, createdAt: new Date().toISOString() };
    db().contracts.push(c);
    return c;
  },
  async deleteContract(tenantId, id) {
    assertTenant(tenantId);
    db().contracts = db().contracts.filter((c) => !(c.tenantId === tenantId && c.id === id));
  },
  async findChannel(kind, externalId) {
    return db().channels.find((c) => c.kind === kind && c.externalId === externalId && c.active) ?? null;
  },

  async listConversations(tenantId, limit = 50) {
    assertTenant(tenantId);
    return db().conversations.filter((c) => c.tenantId === tenantId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
  },
  async listConversationsSince(tenantId, sinceIso) {
    assertTenant(tenantId);
    return db().conversations.filter((c) => c.tenantId === tenantId && c.createdAt >= sinceIso);
  },
  async getConversation(tenantId, id) {
    assertTenant(tenantId);
    return db().conversations.find((c) => c.tenantId === tenantId && c.id === id) ?? null;
  },
  async findOpenConversation(tenantId, channel, contactKey) {
    assertTenant(tenantId);
    return (
      db().conversations.find(
        (c) => c.tenantId === tenantId && c.channel === channel && c.status !== "closed" && (c.contact.phone === contactKey || c.contact.email === contactKey)
      ) ?? null
    );
  },
  async createConversation(tenantId, c) {
    assertTenant(tenantId);
    const conv: Conversation = { ...c, id: randomUUID(), tenantId, status: "open", createdAt: now(), updatedAt: now() };
    db().conversations.push(conv);
    return conv;
  },
  async setConversationStatus(tenantId, id, status) {
    assertTenant(tenantId);
    const c = db().conversations.find((x) => x.tenantId === tenantId && x.id === id);
    if (c) Object.assign(c, { status, updatedAt: now() });
  },
  async listMessages(tenantId, conversationId) {
    assertTenant(tenantId);
    return db().messages.filter((m) => m.tenantId === tenantId && m.conversationId === conversationId);
  },
  async addMessage(tenantId, m) {
    assertTenant(tenantId);
    const msg: Message = { id: db().seq++, tenantId, meta: {}, createdAt: now(), ...m };
    db().messages.push(msg);
    const c = db().conversations.find((x) => x.tenantId === tenantId && x.id === m.conversationId);
    if (c) c.updatedAt = now();
    return msg;
  },

  async listApprovals(tenantId) {
    assertTenant(tenantId);
    return db().approvals.filter((a) => a.tenantId === tenantId).sort(byNewest);
  },
  async createApproval(tenantId, a) {
    assertTenant(tenantId);
    const row: Approval = { ...a, id: randomUUID(), tenantId, status: "pending", decidedBy: null, decidedAt: null, createdAt: now() };
    db().approvals.push(row);
    return row;
  },
  async decideApproval(tenantId, id, status, by) {
    assertTenant(tenantId);
    const a = db().approvals.find((x) => x.tenantId === tenantId && x.id === id && x.status === "pending");
    if (!a) return null;
    Object.assign(a, { status, decidedBy: by, decidedAt: now() });
    return a;
  },

  async listAudit(tenantId, limit = 100) {
    assertTenant(tenantId);
    return db().audit.filter((a) => a.tenantId === tenantId).sort(byNewest).slice(0, limit);
  },
  async audit(tenantId, e) {
    assertTenant(tenantId);
    db().audit.push({ id: db().seq++, tenantId, createdAt: now(), ...e, detail: redactDeep(e.detail ?? {}) });
  },

  async listOutcomes(tenantId, limit = 200) {
    assertTenant(tenantId);
    return db().outcomes.filter((o) => o.tenantId === tenantId).sort(byNewest).slice(0, limit);
  },
  async recordOutcome(tenantId, o) {
    assertTenant(tenantId);
    db().outcomes.push({ id: db().seq++, tenantId, currency: "TTD", createdAt: now(), ...o });
  },
  async listUsage(tenantId, sinceIso) {
    assertTenant(tenantId);
    return db().usage.filter((u) => u.tenantId === tenantId && u.createdAt >= sinceIso);
  },
  async recordUsage(tenantId, u) {
    assertTenant(tenantId);
    db().usage.push({ ...u, id: db().seq++, tenantId, createdAt: now() });
  },

  async listKnowledge(tenantId) {
    assertTenant(tenantId);
    return db().knowledge.filter((k) => k.tenantId === tenantId);
  },
  async addKnowledge(tenantId, d) {
    assertTenant(tenantId);
    const doc: KnowledgeDoc = { ...d, id: randomUUID(), tenantId, createdAt: now() };
    db().knowledge.push(doc);
    return doc;
  },
  async deleteKnowledge(tenantId, id) {
    assertTenant(tenantId);
    db().knowledge = db().knowledge.filter((k) => !(k.tenantId === tenantId && k.id === id));
  },
  async searchKnowledge(tenantId, query, limit = 4) {
    assertTenant(tenantId);
    // Simple keyword scoring; the Supabase store uses Postgres full-text search.
    const terms = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    return db()
      .knowledge.filter((k) => k.tenantId === tenantId)
      .map((k) => {
        const hay = `${k.title} ${k.content}`.toLowerCase();
        return { k, score: terms.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ k }) => ({ id: k.id, title: k.title, content: k.content }));
  },

  async getSettings(tenantId) {
    return db().settings.filter((s) => s.tenantId === tenantId).map(({ key, value, secret }) => ({ key, value, secret }));
  },
  async setSetting(tenantId, key, value, secret) {
    const list = db().settings;
    const existing = list.find((s) => s.tenantId === tenantId && s.key === key);
    if (existing) Object.assign(existing, { value, secret });
    else list.push({ tenantId, key, value, secret });
  },
  async deleteSetting(tenantId, key) {
    db().settings = db().settings.filter((s) => !(s.tenantId === tenantId && s.key === key));
  },
};
