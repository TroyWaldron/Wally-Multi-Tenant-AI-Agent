// The built-in agent runtime: a tool-calling loop on the Claude API (or
// DeepSeek's OpenAI-compatible API) with the policy engine in front of every
// tool. OpenClaw plugs in later as a second runtime behind the same runAgent()
// contract.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaTool, BetaToolResultBlockParam, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { runChatCompletions } from "@/lib/agent/chatCompletions";
import { costUsd, getModel, type ModelInfo } from "@/lib/agent/models";
import { budgetExceeded, evaluate, monthStartIso } from "@/lib/agent/policy";
import { syncKnowledgeIfStale } from "@/lib/knowledgeSync";
import { asModelTools, callConnectorTool, connectorToolsFor, type ConnectorTool } from "@/lib/mcp";
import { notify, runWorkflow } from "@/lib/n8n";
import { getRole, renderPrompt } from "@/lib/roles";
import { getConfig } from "@/lib/settings";
import type { Store } from "@/lib/store/types";
import type { Agent, Conversation, Personality, Tenant } from "@/lib/types";

export type ToolEvent = { tool: string; input: Record<string, unknown>; outcome: "ran" | "sent_for_approval" | "denied" | "error"; result: string };

export type AgentRun = {
  reply: string;
  toolEvents: ToolEvent[];
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  mode: "live" | "demo" | "paused" | "over_budget";
};

const TOOLS: BetaTool[] = [
  {
    name: "search_knowledge",
    description: "Search this business's knowledge base (FAQ, policies, services, prices). Use before answering any factual question about the business.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What to look up, in a few keywords." } }, required: ["query"] },
  },
  {
    name: "capture_lead",
    description: "Save a new enquiry's contact details and what they are interested in. Use once you have a name and at least a phone or email.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        interest: { type: "string", description: "What they want, with dates, group size and budget if known." },
      },
      required: ["name", "interest"],
    },
  },
  {
    name: "record_outcome",
    description: "Log a business result you achieved (for example a booking enquiry created or a ticket resolved) so the owner sees your impact.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "lead, booking, ticket_closed, record_processed, invoice_drafted, call_handled" },
        value: { type: "number", description: "Value in the business's currency, 0 if none." },
        note: { type: "string" },
      },
      required: ["kind", "note"],
    },
  },
  {
    name: "run_workflow",
    description: "Run one of this business's automated workflows (in n8n) and get the result, for example check_availability or quote_price. Only workflows listed in your instructions are enabled.",
    input_schema: {
      type: "object",
      properties: {
        workflow: { type: "string" },
        input: { type: "object", description: "Workflow inputs, e.g. {\"villa\":\"sugar-haven-villa-1\",\"check_in\":\"2026-12-12\",\"check_out\":\"2026-12-16\",\"guests\":8}" },
      },
      required: ["workflow", "input"],
    },
  },
  {
    name: "request_approval",
    description: "Ask a human at the business to approve an action you are not allowed to take alone (anything on your needs-approval list).",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Short action name, e.g. discount, refund, booking_change." },
        summary: { type: "string", description: "One or two sentences a busy owner can decide on." },
        details: { type: "object" },
      },
      required: ["action", "summary"],
    },
  },
  {
    name: "escalate_to_human",
    description: "Hand this conversation to a person: complaints, emergencies, anything you cannot resolve, or when the customer asks for a human.",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
  },
];

function describe(p: Personality) {
  const band = (v: number, lo: string, mid: string, hi: string) => (v < 34 ? lo : v < 67 ? mid : hi);
  return [
    band(p.warmth, "reserved and matter-of-fact", "friendly", "very warm and welcoming"),
    band(p.humor, "no jokes", "light humour when it fits", "playful"),
    band(p.formality, "casual", "professional but relaxed", "formal"),
    band(p.directness, "gentle and indirect", "clear", "very direct and brief"),
  ].join("; ");
}

/** Today's date where the business is, e.g. "Sunday, 27 September 2026". */
function todayIn(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
}

/**
 * Models lean on em and en dashes, which read as machine-written to guests.
 * Swap them for plain punctuation: "1–3" becomes "1 to 3", other dashes a comma.
 */
export function humanize(text: string) {
  return text
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1 to $2")
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
    .replace(/,\s*([,.!?])/g, "$1");
}

export function buildSystemPrompt(tenant: Tenant, agent: Agent) {
  const role = getRole(agent.templateKey);
  const base = renderPrompt(role?.systemPrompt ?? "You are an AI assistant for {{tenant}}.", {
    tenant: tenant.name,
    role: (agent.title ?? role?.name ?? "assistant").toLowerCase(),
  });
  const b = agent.boundaries;
  const profile = Object.entries(tenant.profile)
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return `${base}

Today is ${todayIn(tenant.timezone)} (${tenant.timezone}).

Your name is ${agent.name}${agent.title ? `, ${agent.title}` : ""}.
Tone: ${describe(agent.personality)}.

About the business:
${profile || "- (no profile yet)"}
- currency: ${tenant.currency}; timezone: ${tenant.timezone}

Decision boundaries:
- Needs approval (use request_approval): ${b.approvalRequired.join(", ") || "nothing"}
- Workflows you can run: ${b.workflows.join(", ") || "none"}
- You cannot: ${b.cannot.join("; ") || "no extra limits"}
${b.hours ? `- Working hours: ${b.hours}` : ""}
${agent.instructions ? `\nInstructions from the business:\n${agent.instructions}` : ""}`.trim();
}

export type ToolContext = { store: Store; tenant: Tenant; agent: Agent; conversation: Conversation; dryRun?: boolean; connectorTools?: Map<string, ConnectorTool> };

// In a scenario test (dryRun) these read and nothing else; every other tool
// is simulated so a test never creates a lead, an approval or a handover.
const READ_ONLY_WORKFLOWS = new Set(["check_availability", "quote_price", "list_payments", "list_bookings", "check_calendar"]);

export async function executeTool(block: { name: string; input: unknown }, ctx: ToolContext): Promise<ToolEvent> {
  const { store, tenant, agent, conversation } = ctx;
  const input = (block.input ?? {}) as Record<string, unknown>;
  const ev = (outcome: ToolEvent["outcome"], result: string): ToolEvent => ({ tool: block.name, input, outcome, result });

  const ct = ctx.connectorTools?.get(block.name);
  if (ct) return runConnectorTool(ct, input, ctx, ev);

  if (ctx.dryRun && block.name !== "search_knowledge" && !(block.name === "run_workflow" && READ_ONLY_WORKFLOWS.has(String(input.workflow)))) {
    const policy = evaluate(agent, block.name, input);
    if (policy.decision === "deny") return ev("denied", `Not allowed: ${policy.reason} Ask for approval or escalate instead.`);
    if (policy.decision === "approval" || block.name === "request_approval")
      return ev("sent_for_approval", "(Test) Sent to the team. Tell the customer someone will confirm shortly.");
    if (block.name === "escalate_to_human") return ev("ran", "(Test) A team member has been alerted and will take over. Let the customer know.");
    return ev("ran", "(Test) Done.");
  }

  const policy = evaluate(agent, block.name, input);
  if (policy.decision === "deny") {
    await store.audit(tenant.id, { actorType: "agent", actor: agent.name, action: "tool.denied", detail: { tool: block.name, input, reason: policy.reason } });
    return ev("denied", `Not allowed: ${policy.reason} Ask for approval or escalate instead.`);
  }
  if (policy.decision === "approval") {
    const a = await store.createApproval(tenant.id, {
      agentId: agent.id,
      conversationId: conversation.id,
      kind: "action",
      action: String(input.workflow ?? block.name),
      summary: `${agent.name} wants to run ${String(input.workflow)}.`,
      payload: { workflow: input.workflow, input: input.input ?? {} },
    });
    notify(tenant, "approval_requested", { approval: a });
    await store.audit(tenant.id, { actorType: "agent", actor: agent.name, action: "approval.requested", detail: { approvalId: a.id, tool: block.name, input } });
    return ev("sent_for_approval", "Sent to the team for approval. Tell the customer the team will confirm shortly.");
  }

  await store.audit(tenant.id, { actorType: "agent", actor: agent.name, action: `tool.${block.name}`, detail: { input, conversationId: conversation.id } });

  switch (block.name) {
    case "search_knowledge": {
      const hits = await store.searchKnowledge(tenant.id, String(input.query ?? ""));
      if (!hits.length) return ev("ran", "No matching knowledge found. Do not guess; offer to check with the team.");
      return ev("ran", hits.map((h) => `## ${h.title}\n${h.content}`).join("\n\n"));
    }
    case "capture_lead": {
      await store.recordOutcome(tenant.id, { agentId: agent.id, kind: "lead", value: 0, note: `${input.name}: ${input.interest}` });
      notify(tenant, "lead_captured", { lead: input, conversationId: conversation.id, agent: agent.name });
      return ev("ran", "Lead saved and the team notified.");
    }
    case "record_outcome": {
      await store.recordOutcome(tenant.id, { agentId: agent.id, kind: String(input.kind), value: Number(input.value ?? 0), note: String(input.note ?? "") });
      notify(tenant, "outcome_recorded", { outcome: input, agent: agent.name });
      return ev("ran", "Recorded.");
    }
    case "request_approval": {
      const a = await store.createApproval(tenant.id, {
        agentId: agent.id,
        conversationId: conversation.id,
        kind: "action",
        action: String(input.action),
        summary: String(input.summary),
        payload: (input.details as Record<string, unknown>) ?? {},
      });
      notify(tenant, "approval_requested", { approval: a });
      return ev("sent_for_approval", "Sent to the team. Tell the customer someone will confirm shortly.");
    }
    case "escalate_to_human": {
      const a = await store.createApproval(tenant.id, {
        agentId: agent.id,
        conversationId: conversation.id,
        kind: "escalation",
        action: "handover",
        summary: String(input.reason),
        payload: { contact: conversation.contact, channel: conversation.channel },
      });
      await store.setConversationStatus(tenant.id, conversation.id, "waiting_human");
      notify(tenant, "escalated", { approval: a, conversationId: conversation.id });
      return ev("ran", "A team member has been alerted and will take over. Let the customer know.");
    }
    case "run_workflow": {
      const r = await runWorkflow(tenant, String(input.workflow), (input.input as Record<string, unknown>) ?? {}, {
        agent: agent.name,
        conversationId: conversation.id,
        contact: conversation.contact,
      });
      if (!r.ok) return ev("error", `The ${String(input.workflow)} workflow isn't available right now (${r.error ?? `HTTP ${r.status}`}). Offer to have the team follow up.`);
      return ev("ran", typeof r.body === "string" ? r.body : JSON.stringify(r.body));
    }
    default:
      return ev("error", `Unknown tool ${block.name}.`);
  }
}

// A tool from one of the business's connectors. Only offered to agents the
// connector lists; tools marked for approval go to the approval inbox and run
// when a person approves them.
async function runConnectorTool(ct: ConnectorTool, input: Record<string, unknown>, ctx: ToolContext, ev: (o: ToolEvent["outcome"], r: string) => ToolEvent) {
  const { store, tenant, agent, conversation } = ctx;
  if (ctx.dryRun && (ct.approval || !ct.readOnly)) return ev(ct.approval ? "sent_for_approval" : "ran", "(Test) Done.");
  if (ct.approval) {
    const a = await store.createApproval(tenant.id, {
      agentId: agent.id,
      conversationId: conversation.id,
      kind: "action",
      action: `${ct.connector.name}: ${ct.tool.name}`,
      summary: `${agent.name} wants to use ${ct.tool.name} in ${ct.connector.name}.`,
      payload: { connectorId: ct.connector.id, tool: ct.tool.name, arguments: input },
    });
    notify(tenant, "approval_requested", { approval: a });
    await store.audit(tenant.id, { actorType: "agent", actor: agent.name, action: "approval.requested", detail: { approvalId: a.id, connector: ct.connector.name, tool: ct.tool.name } });
    return ev("sent_for_approval", "Sent to the team for approval. Say the team will confirm shortly.");
  }
  await store.audit(tenant.id, { actorType: "agent", actor: agent.name, action: "tool.connector", detail: { connector: ct.connector.name, tool: ct.tool.name, input, conversationId: conversation.id } });
  try {
    return ev("ran", await callConnectorTool(ct.connector, ct.tool.name, input));
  } catch (err) {
    return ev("error", `${ct.connector.name} couldn't do that right now (${err instanceof Error ? err.message : "error"}). Offer to have the team follow up.`);
  }
}

export function historyToMessages(history: { role: string; content: string }[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of history) {
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "staff") continue;
    const role = m.role === "user" ? "user" : "assistant";
    const text = m.role === "staff" ? `[A team member replied] ${m.content}` : m.content;
    const last = out[out.length - 1];
    if (last && last.role === role && typeof last.content === "string") last.content += `\n\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function demoReply(store: Store, tenant: Tenant, agent: Agent, text: string): Promise<string> {
  const hits = await store.searchKnowledge(tenant.id, text, 2);
  const intro = `(Demo mode: add an Anthropic or DeepSeek API key in Settings for real answers.) Hi, I'm ${agent.name} from ${tenant.name}.`;
  if (!hits.length) return `${intro} I couldn't find that in the knowledge base, so I'd pass it to the team.`;
  return `${intro} Here's what I found:\n\n${hits.map((h) => `• ${h.title}: ${h.content}`).join("\n")}`;
}

export async function runAgent(args: {
  store: Store;
  tenant: Tenant;
  agent: Agent;
  conversation: Conversation;
  text: string;
  /** Scenario tests: no side effects and no n8n notifications. */
  dryRun?: boolean;
}): Promise<AgentRun> {
  const { store, tenant, agent, conversation, text, dryRun } = args;
  const empty = { toolEvents: [], model: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  await store.addMessage(tenant.id, { conversationId: conversation.id, role: "user", content: text });
  if (!dryRun) notify(tenant, "message_received", { conversationId: conversation.id, channel: conversation.channel, contact: conversation.contact, text });

  const finish = async (run: AgentRun) => {
    await store.addMessage(tenant.id, {
      conversationId: conversation.id,
      role: "assistant",
      content: run.reply,
      meta: { toolEvents: run.toolEvents, model: run.model, mode: run.mode, costUsd: run.costUsd },
    });
    if (!dryRun) notify(tenant, "agent_replied", { conversationId: conversation.id, channel: conversation.channel, contact: conversation.contact, reply: run.reply, agent: agent.name });
    return run;
  };

  if (agent.status === "paused") {
    return finish({ ...empty, mode: "paused", reply: `${agent.name} is paused right now. A team member will reply to you shortly.` });
  }

  const spent = (await store.listUsage(tenant.id, monthStartIso())).filter((u) => u.agentId === agent.id).reduce((s, u) => s + u.costUsd, 0);
  if (budgetExceeded(agent, spent)) {
    notify(tenant, "budget_exceeded", { agent: agent.name, spentUsd: spent, budgetUsd: agent.monthlyBudgetUsd });
    await store.audit(tenant.id, { actorType: "system", actor: "policy", action: "budget.exceeded", detail: { agentId: agent.id, spent } });
    return finish({ ...empty, mode: "over_budget", reply: "Thanks for your message. A team member will get back to you shortly." });
  }

  const keys = {
    anthropic: await getConfig(null, "ANTHROPIC_API_KEY"),
    deepseek: await getConfig(null, "DEEPSEEK_API_KEY"),
    openai: await getConfig(null, "OPENAI_API_KEY"),
  };
  // Router: the agent's model, then its fallback, then whichever provider has
  // a key. Providers without a key are skipped.
  const modelOrder = [agent.model, agent.fallbackModel, "claude-haiku-4-5", "deepseek-chat", "gpt-fallback"]
    .map((id) => getModel(id))
    .filter((m): m is ModelInfo => Boolean(m && keys[m.provider]))
    .filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i)
    .slice(0, 2);
  if (!modelOrder.length) return finish({ ...empty, mode: "demo", reply: await demoReply(store, tenant, agent, text) });

  await syncKnowledgeIfStale(tenant);
  const system = buildSystemPrompt(tenant, agent);
  const connectorTools = await connectorToolsFor(store, tenant.id, agent);
  const tools = [
    ...TOOLS.filter((t) => t.name === "request_approval" || t.name === "escalate_to_human" || agent.boundaries.allowedTools.includes(t.name)),
    ...asModelTools(connectorTools),
  ];
  const history = await store.listMessages(tenant.id, conversation.id);
  const ctx = { store, tenant, agent, conversation, dryRun, connectorTools };

  const toolEvents: ToolEvent[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let reply = "";
  let usedModel: string | null = null;
  let billedAs = modelOrder[0].id;

  for (const info of modelOrder) {
    try {
      const r =
        info.provider !== "anthropic"
          ? await runChatCompletions({ provider: info.provider, apiKey: keys[info.provider]!, model: info.apiModel ?? info.id, system, tools, history: historyToMessages(history.slice(-30)), ctx, toolEvents })
          : await runClaude({ apiKey: keys.anthropic!, info, system, tools, messages: historyToMessages(history.slice(-30)), ctx, toolEvents });
      usedModel = r.model;
      billedAs = info.id;
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
      reply = humanize(r.reply);
      break;
    } catch (err) {
      console.error(`Agent ${agent.name} on ${info.id} failed:`, err);
      await store.audit(tenant.id, { actorType: "system", actor: "router", action: "model.failed", detail: { model: info.id, error: err instanceof Error ? err.message : String(err) } });
      if (info === modelOrder[modelOrder.length - 1]) reply = "Sorry, I'm having trouble right now. A team member will follow up with you.";
    }
  }

  // Price by the catalog entry that ran: providers may report a different
  // model name (DeepSeek answers as "deepseek-flash").
  const cost = costUsd(getModel(usedModel) ? usedModel! : billedAs, inputTokens, outputTokens);
  await store.recordUsage(tenant.id, { agentId: agent.id, kind: "llm", model: usedModel, inputTokens, outputTokens, minutes: 0, costUsd: cost });
  return finish({
    reply: reply || "Thanks, the team will follow up with you shortly.",
    toolEvents,
    model: usedModel,
    inputTokens,
    outputTokens,
    costUsd: cost,
    mode: "live",
  });
}

type LoopResult = { reply: string; model: string | null; inputTokens: number; outputTokens: number };

async function runClaude(args: {
  apiKey: string;
  info: ModelInfo;
  system: string;
  tools: BetaTool[];
  messages: BetaMessageParam[];
  ctx: ToolContext;
  toolEvents: ToolEvent[];
}): Promise<LoopResult> {
  const { info, system, tools, messages, ctx, toolEvents } = args;
  const client = new Anthropic({ apiKey: args.apiKey });
  const out: LoopResult = { reply: "", model: null, inputTokens: 0, outputTokens: 0 };
  for (let turn = 0; turn < 6; turn++) {
    const response = await client.beta.messages.create({
      model: info.id,
      max_tokens: 4096,
      system,
      tools,
      messages,
      ...(info.supportsEffort ? { output_config: { effort: ctx.agent.effort } } : {}),
      // Opus 5: if a request is declined, the API retries it on a fallback model in the same call.
      ...(info.id === "claude-opus-5" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    out.model = response.model;
    out.inputTokens += response.usage.input_tokens;
    out.outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "refusal") {
      out.reply = "I can't help with that one, but I've let the team know.";
      return out;
    }
    const textOut = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n")
      .trim();
    const uses = response.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use" || uses.length === 0) {
      out.reply = textOut;
      return out;
    }
    const results: BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const ev = await executeTool(use, ctx);
      toolEvents.push(ev);
      results.push({ type: "tool_result", tool_use_id: use.id, content: ev.result, is_error: ev.outcome === "error" || ev.outcome === "denied" });
    }
    messages.push({ role: "user", content: results });
  }
  return out;
}
