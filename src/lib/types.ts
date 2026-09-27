// App-level shapes (camelCase). The Supabase store maps snake_case rows to
// these; the demo store holds them directly.

export type Personality = {
  warmth: number; // 0-100
  humor: number;
  formality: number;
  directness: number;
  voicePace: number;
};

export type Boundaries = {
  /** Tools the agent may call at all. */
  allowedTools: string[];
  /** Actions (approval "action" names or workflow names) that must go to the approval inbox. */
  approvalRequired: string[];
  /** n8n workflows this agent may trigger through run_workflow. */
  workflows: string[];
  /** Plain-language "cannot do" list, written into the system prompt. */
  cannot: string[];
  hours?: string;
};

export type RoleTemplate = {
  id: string;
  tenantId: string | null;
  key: string;
  name: string;
  category: string;
  summary: string;
  systemPrompt: string;
  defaultBoundaries: Boundaries;
  defaultPersonality: Personality;
  voiceEnabled: boolean;
  version: number;
};

export type Agency = { id: string; name: string; slug: string };

export type Tenant = {
  id: string;
  agencyId: string | null;
  name: string;
  slug: string;
  industry: string | null;
  country: string;
  timezone: string;
  currency: string;
  status: "trial" | "active" | "paused" | "offboarded";
  publicKey: string;
  profile: { about?: string; hours?: string; phone?: string; email?: string; website?: string; address?: string };
  branding: { color?: string; welcome?: string; avatar?: string; position?: "left" | "right" };
  createdAt: string;
};

export type AgentStatus = "draft" | "live" | "paused";
export type Effort = "low" | "medium" | "high";

export type Agent = {
  id: string;
  tenantId: string;
  templateKey: string;
  name: string;
  title: string | null;
  avatar: string | null;
  status: AgentStatus;
  model: string;
  fallbackModel: string | null;
  effort: Effort;
  instructions: string;
  personality: Personality;
  boundaries: Boundaries;
  channels: string[];
  voice: { tts?: string; voiceId?: string; stt?: string };
  monthlyBudgetUsd: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * What a business pays Wally for an AI staff member (or a business-wide
 * line), as agreed in its contract. Customer-facing; the model providers'
 * cost to Wally lives in usage events and is never shown to the business.
 */
export type Contract = {
  id: string;
  tenantId: string;
  agentId: string | null;
  planName: string;
  currency: string;
  monthlyFee: number;
  includedConversations: number;
  overageRate: number;
  setupFee: number;
  startsOn: string;
  endsOn: string | null;
  status: "active" | "ended";
  notes: string | null;
  createdAt: string;
};

export type Channel = {
  id: string;
  tenantId: string;
  agentId: string | null;
  kind: "web" | "whatsapp" | "email" | "slack" | "teams" | "phone" | "sms" | "webhook";
  externalId: string;
  label: string | null;
  active: boolean;
};

export type Conversation = {
  id: string;
  tenantId: string;
  agentId: string | null;
  channel: string;
  contact: { name?: string; phone?: string; email?: string };
  status: "open" | "waiting_human" | "closed";
  createdAt: string;
  updatedAt: string;
};

export type MessageRole = "user" | "assistant" | "tool" | "system" | "staff";
export type Message = {
  id: number;
  tenantId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  meta: Record<string, unknown>;
  createdAt: string;
};

export type Approval = {
  id: string;
  tenantId: string;
  agentId: string | null;
  conversationId: string | null;
  kind: "action" | "escalation";
  action: string;
  summary: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type AuditEntry = {
  id: number;
  tenantId: string;
  actorType: "agent" | "user" | "system" | "n8n" | "widget";
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type OutcomeEvent = {
  id: number;
  tenantId: string;
  agentId: string | null;
  kind: string;
  value: number;
  currency: string;
  note: string | null;
  createdAt: string;
};

export type UsageEvent = {
  id: number;
  tenantId: string;
  agentId: string | null;
  kind: "llm" | "voice_stt" | "voice_tts" | "telephony" | "tool";
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  minutes: number;
  costUsd: number;
  createdAt: string;
};

export type KnowledgeDoc = {
  id: string;
  tenantId: string;
  title: string;
  source: string;
  content: string;
  createdAt: string;
};

export type SettingRow = { key: string; value: string; secret: boolean };
