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
  RoleTemplate,
  SettingRow,
  Tenant,
  UsageEvent,
} from "@/lib/types";

/**
 * Every tenant-scoped method takes tenantId first and implementations call
 * assertTenant() before touching data: the phantom tenant guard from the
 * concept. A missing tenant is a bug, never "all tenants".
 */
export interface Store {
  readonly mode: "demo" | "supabase";

  listTenants(): Promise<Tenant[]>;
  getTenant(id: string): Promise<Tenant | null>;
  getTenantByPublicKey(key: string): Promise<Tenant | null>;
  getTenantBySlug(slug: string): Promise<Tenant | null>;
  createTenant(input: Pick<Tenant, "name" | "slug"> & Partial<Tenant>): Promise<Tenant>;
  updateTenant(id: string, patch: Partial<Tenant>): Promise<void>;

  listTemplates(tenantId: string): Promise<RoleTemplate[]>;

  listAgents(tenantId: string): Promise<Agent[]>;
  getAgent(tenantId: string, id: string): Promise<Agent | null>;
  saveAgent(tenantId: string, agent: Omit<Agent, "id" | "createdAt" | "updatedAt" | "tenantId"> & { id?: string }): Promise<Agent>;
  deleteAgent(tenantId: string, id: string): Promise<void>;

  listChannels(tenantId: string): Promise<Channel[]>;
  saveChannel(tenantId: string, ch: Omit<Channel, "id" | "tenantId"> & { id?: string }): Promise<Channel>;
  deleteChannel(tenantId: string, id: string): Promise<void>;
  /** Global router lookup (not tenant-scoped by design): resolves which tenant owns an external id. */
  findChannel(kind: Channel["kind"], externalId: string): Promise<Channel | null>;

  listConnectors(tenantId: string): Promise<Connector[]>;
  saveConnector(tenantId: string, c: Omit<Connector, "id" | "tenantId" | "createdAt"> & { id?: string }): Promise<Connector>;
  deleteConnector(tenantId: string, id: string): Promise<void>;
  listContracts(tenantId: string): Promise<Contract[]>;
  saveContract(tenantId: string, c: Omit<Contract, "id" | "tenantId" | "createdAt"> & { id?: string }): Promise<Contract>;
  deleteContract(tenantId: string, id: string): Promise<void>;

  listConversations(tenantId: string, limit?: number): Promise<Conversation[]>;
  /** Every conversation started since a moment (for monthly counts and billing). */
  listConversationsSince(tenantId: string, sinceIso: string): Promise<Pick<Conversation, "id" | "agentId" | "channel" | "status" | "createdAt">[]>;
  getConversation(tenantId: string, id: string): Promise<Conversation | null>;
  findOpenConversation(tenantId: string, channel: string, contactKey: string): Promise<Conversation | null>;
  createConversation(tenantId: string, c: Pick<Conversation, "agentId" | "channel" | "contact">): Promise<Conversation>;
  setConversationStatus(tenantId: string, id: string, status: Conversation["status"]): Promise<void>;
  listMessages(tenantId: string, conversationId: string): Promise<Message[]>;
  addMessage(tenantId: string, m: Pick<Message, "conversationId" | "role" | "content"> & { meta?: Record<string, unknown> }): Promise<Message>;

  listApprovals(tenantId: string): Promise<Approval[]>;
  createApproval(tenantId: string, a: Pick<Approval, "agentId" | "conversationId" | "kind" | "action" | "summary" | "payload">): Promise<Approval>;
  decideApproval(tenantId: string, id: string, status: "approved" | "rejected", by: string): Promise<Approval | null>;

  listAudit(tenantId: string, limit?: number): Promise<AuditEntry[]>;
  audit(tenantId: string, e: Pick<AuditEntry, "actorType" | "actor" | "action"> & { detail?: Record<string, unknown> }): Promise<void>;

  listOutcomes(tenantId: string, limit?: number): Promise<OutcomeEvent[]>;
  recordOutcome(tenantId: string, o: Pick<OutcomeEvent, "agentId" | "kind" | "value" | "note"> & { currency?: string }): Promise<void>;
  listUsage(tenantId: string, sinceIso: string): Promise<UsageEvent[]>;
  recordUsage(tenantId: string, u: Omit<UsageEvent, "id" | "tenantId" | "createdAt">): Promise<void>;

  listKnowledge(tenantId: string): Promise<KnowledgeDoc[]>;
  addKnowledge(tenantId: string, d: Pick<KnowledgeDoc, "title" | "content" | "source">): Promise<KnowledgeDoc>;
  deleteKnowledge(tenantId: string, id: string): Promise<void>;
  searchKnowledge(tenantId: string, query: string, limit?: number): Promise<Pick<KnowledgeDoc, "id" | "title" | "content">[]>;
  /** Semantic search: documents nearest to an embedding, best first. */
  matchKnowledge(tenantId: string, embedding: number[], limit?: number): Promise<(Pick<KnowledgeDoc, "id" | "title" | "content"> & { similarity: number })[]>;
  listUnembeddedKnowledge(tenantId: string, limit: number): Promise<Pick<KnowledgeDoc, "id" | "title" | "content">[]>;
  setKnowledgeEmbedding(tenantId: string, id: string, embedding: number[]): Promise<void>;

  /** tenantId null = platform-wide settings. */
  getSettings(tenantId: string | null): Promise<SettingRow[]>;
  setSetting(tenantId: string | null, key: string, value: string, secret: boolean): Promise<void>;
  deleteSetting(tenantId: string | null, key: string): Promise<void>;
}

export function assertTenant(tenantId: string | null | undefined): asserts tenantId is string {
  if (!tenantId) throw new Error("Phantom tenant guard: a tenant-scoped query ran without a tenant id.");
}
