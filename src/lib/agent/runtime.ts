// The built-in agent runtime: a tool-calling loop on the Claude API (or
// DeepSeek's OpenAI-compatible API) with the policy engine in front of every
// tool. OpenClaw plugs in later as a second runtime behind the same runAgent()
// contract.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaTool, BetaToolResultBlockParam, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { runChatCompletions } from "@/lib/agent/chatCompletions";
import { costUsd, getModel, type ModelInfo } from "@/lib/agent/models";
import { budgetExceeded, evaluate, monthStartIso, worksWithTeam } from "@/lib/agent/policy";
import { MANAGERS, describeTasks, dueAtFrom, messageStaff, whenIn } from "@/lib/staffDesk";
import { buildExcel, buildWord, documentLink, LINK_DAYS, saveDocument, type Sheet } from "@/lib/documents";
import { emailConfigured, splitAddresses } from "@/lib/email";
import { sendOrAsk } from "@/lib/officeMail";
import { createDraft } from "@/lib/drafts";
import { findColleague, teamLine } from "@/lib/agent/colleagues";
import { searchKnowledge } from "@/lib/embeddings";
import { syncKnowledgeIfStale } from "@/lib/knowledgeSync";
import { asModelTools, callConnectorTool, connectorToolsFor, type ConnectorTool } from "@/lib/mcp";
import { notify, runWorkflow, sendBookingRequest } from "@/lib/n8n";
import { getRole, renderPrompt } from "@/lib/roles";
import { getConfig } from "@/lib/settings";
import { withVariant } from "@/lib/personas";
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
    description:
      "Pass a customer's enquiry or booking request to the team: saves their contact details and puts the request in the business's bookings list for a person to follow up. Use it as soon as they want to book or enquire and you have a name and an email or phone. If they change anything later (dates, villa, group size, extra wishes), call it again with the full, corrected details: it updates the same request.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        interest: { type: "string", description: "What they want, in a sentence, with dates, group size and budget if known." },
        villa: { type: "string", description: "The villa id they chose, if any." },
        check_in: { type: "string", description: "YYYY-MM-DD" },
        check_out: { type: "string", description: "YYYY-MM-DD" },
        guests: { type: "number" },
        quote: { type: "string", description: "The price you quoted from the workflow, e.g. 'TT$1,600 a night, TT$4,800 for 3 nights'." },
        notes: { type: "string", description: "Anything else they asked the team for." },
        about: { type: "string", enum: ["stay", "property_management"], description: "stay (a guest wanting to book or enquire, the default) or property_management (an owner who wants the business to manage their property)." },
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
    name: "end_chat",
    description: "Close this chat once the customer is done (they say goodbye, 'no thanks', 'that's all'). Send your short goodbye in the same reply. If they write again later, the chat reopens.",
    input_schema: { type: "object", properties: { summary: { type: "string", description: "One line for the team: what they wanted and what happened." } }, required: ["summary"] },
  },
  {
    name: "escalate_to_human",
    description: "Hand this conversation to a person: complaints, emergencies, anything you cannot resolve, or when the customer asks for a human.",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
  },
];

// For back-office AI staff: working with the business's people.
const OFFICE_TOOL_DEFS: BetaTool[] = [
  {
    name: "message_staff",
    description: `Send a short message to a person at the business, or to "${MANAGERS}". It reaches their phone through the business's back office. Use it to ask for something, pass on information or follow up. Staff can reply to you.`,
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: `The person's name as the team uses it, or "${MANAGERS}".` },
        text: { type: "string", description: "The message, plain and brief, as you'd text a colleague." },
      },
      required: ["to", "text"],
    },
  },
  {
    name: "add_follow_up",
    description: "Set a follow-up for a person (or the managers): something they should do by a time. They are told now, and reminded automatically when it falls due; if it keeps being ignored the managers are told.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What needs doing, e.g. 'Confirm pool service for Villa Arizia'." },
        assignee: { type: "string", description: `The person's name, or "${MANAGERS}".` },
        due: { type: "string", description: "When, in the business's time: YYYY-MM-DD or YYYY-MM-DD HH:MM." },
        detail: { type: "string", description: "Anything they need to know." },
      },
      required: ["title", "assignee", "due"],
    },
  },
  {
    name: "list_follow_ups",
    description: "List the open follow-ups (yours and other AI staff's), with ids, who owns them and when they're due.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "close_follow_up",
    description: "Mark a follow-up done (or cancelled) once the person confirms it, with a short note.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, note: { type: "string" }, cancelled: { type: "boolean" } },
      required: ["id"],
    },
  },
];

const COLLEAGUE_TOOL_DEF: BetaTool = {
  name: "ask_colleague",
  description: "Ask one of your AI colleagues (the other AI staff at this business) a question and get their answer straight away. Use it whenever they hold information you need. They are always available.",
  input_schema: {
    type: "object",
    properties: {
      colleague: { type: "string", description: "Their name, e.g. Coco." },
      question: { type: "string", description: "What you need, with enough context for them to answer in one go." },
    },
    required: ["colleague", "question"],
  },
};

// Drafting from what's on file: look things up first (your tools, connectors,
// knowledge, look_up_history), then write it for a person to check and approve.
const DRAFT_TOOL_DEFS: BetaTool[] = [
  {
    name: "look_up_history",
    description: "Find past conversations Wally has had with a person (website chat, WhatsApp, email), by name, email or phone, with their recent messages. Use before drafting to someone.",
    input_schema: { type: "object", properties: { who: { type: "string", description: "Name, email or phone." } }, required: ["who"] },
  },
  {
    name: "draft_message",
    description:
      "Write a message or email for someone (a guest, supplier, owner) from what's on file, for a person at the business to check, edit and approve before it goes out. Look up the facts first; never invent details. Use this whenever you're asked to draft, prepare or write something to send.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["email", "whatsapp", "sms"] },
        to: { type: "string", description: "Their email address or phone number if on file, else blank." },
        to_name: { type: "string" },
        subject: { type: "string", description: "Email only." },
        body: { type: "string", description: "The full message, ready to send, signed off as the business." },
        about: { type: "string", description: "A few words for the approver, e.g. 'reply to his Tropicbird enquiry'." },
        document_ids: { type: "array", items: { type: "string" }, description: "Documents from create_document to attach (email)." },
      },
      required: ["channel", "body", "about"],
    },
  },
];

const EMAIL_TOOL_DEF: BetaTool = {
  name: "send_email",
  description: "Send an email from the business's mailbox. Emails to the business's own staff go straight out; to anyone else (guests, suppliers) they wait for a person's approval. You can attach documents you created.",
  input_schema: {
    type: "object",
    properties: {
      to: { type: "array", items: { type: "string" }, description: "Email addresses." },
      subject: { type: "string" },
      body: { type: "string", description: "Plain text, signed off with your name and the business's name." },
      document_ids: { type: "array", items: { type: "string" }, description: "Ids from create_document to attach." },
    },
    required: ["to", "subject", "body"],
  },
};

const PAPERWORK_TOOL_DEFS: BetaTool[] = [
  {
    name: "add_calendar_entry",
    description: "Put something in people's calendars: sends a calendar invite (works with Google, Outlook and Apple) from the business's mailbox. Staff invites go straight out; anyone else waits for approval.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "Business time: YYYY-MM-DD HH:MM." },
        minutes: { type: "number", description: "Length, default 60." },
        attendees: { type: "array", items: { type: "string" }, description: "Email addresses." },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "start", "attendees"],
    },
  },
  {
    name: "create_document",
    description: "Create a document and get a download link (valid 7 days) and an id to attach to emails. kind 'letter' is a letter on the business's letterhead, 'word' a Word document, 'excel' a spreadsheet.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["letter", "word", "excel"] },
        title: { type: "string", description: "Document title, or the letter's subject line." },
        body: { type: "string", description: "letter/word: the text. Blank lines between paragraphs, '# ' for headings, '- ' for bullets." },
        to: { type: "string", description: "letter: recipient name and address, one line each." },
        sign_off: { type: "string", description: "letter: e.g. 'Kind regards,\nCoco\nOperations, Sunsational Tobago'." },
        sheets: {
          type: "array",
          description: "excel: one or more sheets.",
          items: {
            type: "object",
            properties: { name: { type: "string" }, columns: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: ["string", "number", "null"] } } } },
            required: ["name", "columns", "rows"],
          },
        },
      },
      required: ["kind", "title"],
    },
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

// For agents who talk to customers: every request reaches a person, nothing
// is claimed that didn't happen, and every chat ends.
const CUSTOMER_RULES = `Looking after requests:
- When the customer wants to book or enquire, get their name and an email or phone, then call capture_lead with the villa, dates, group size and your quote. This is how the team gets it; you never book or confirm anything yourself.
- If they change anything afterwards (dates, villa, guests) or ask the team for something extra, call capture_lead again with the full corrected details before you reply.
- Only say you saved, passed on, sent or updated something when a tool did it in this chat and said so. Otherwise say what you will do and do it.
- If a date is in the past or doesn't exist, ask what they meant instead of guessing.
- When they're done (goodbye, "no thanks", "that's all"), say a short goodbye and call end_chat.`;

export function buildSystemPrompt(tenant: Tenant, agent: Agent, team: Agent[] = []) {
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

Your name is ${agent.name}${agent.title ? `, ${agent.title}` : ""}. You are only ${agent.name}: never speak as another team member.
${teamLine(team, agent) ? `Your AI colleagues: ${teamLine(team, agent)}. They are AI like you and always available: to get information from one, use ask_colleague and you get their answer at once. Never say a colleague is away, busy or hasn't replied. Refer to colleagues by name, never "he" or "she".` : ""}
Tone: ${describe(agent.personality)}.

About the business:
${profile || "- (no profile yet)"}
- currency: ${tenant.currency}; timezone: ${tenant.timezone}

Decision boundaries:
- Needs approval (use request_approval): ${b.approvalRequired.join(", ") || "nothing"}
- Workflows you can run: ${b.workflows.join(", ") || "none"}
- You cannot: ${b.cannot.join("; ") || "no extra limits"}
${b.hours ? `- Working hours: ${b.hours}` : ""}
${worksWithTeam(agent) ? "" : `\n${CUSTOMER_RULES}`}
${worksWithTeam(agent) ? `\nYou work with the ${tenant.name} team, not its customers. When something needs a person, message them (message_staff) or set a follow-up with a due time (add_follow_up); Wally reminds them and tells the managers if it's ignored. Close follow-ups when people confirm. Keep messages short, like texting a colleague.` : ""}
${agent.instructions ? `\nInstructions from the business:\n${agent.instructions}` : ""}`.trim();
}

export type ToolContext = { store: Store; tenant: Tenant; agent: Agent; conversation: Conversation; dryRun?: boolean; connectorTools?: Map<string, ConnectorTool>; /** 1 inside a colleague's question: no further hops. */ depth?: number };

// In a scenario test (dryRun) these read and nothing else; every other tool
// is simulated so a test never creates a lead, an approval or a handover.
const READ_ONLY_WORKFLOWS = new Set(["check_availability", "quote_price", "list_payments", "list_bookings", "check_calendar"]);

/** The agent tried to book (a create_enquiry workflow, tool or approval): that is a request for the team. */
function isBookingRequest(name: string, input: Record<string, unknown>) {
  if (name === "create_enquiry") return true;
  if (name === "run_workflow") return input.workflow === "create_enquiry";
  if (name === "request_approval") return input.action === "create_enquiry";
  return false;
}

function bookingInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const d = ((name === "run_workflow" ? input.input : name === "request_approval" ? input.details : input) ?? {}) as Record<string, unknown>;
  const summary = name === "request_approval" && typeof input.summary === "string" ? input.summary : "";
  return { ...d, name: d.name ?? "Guest", interest: d.interest ?? (summary || "Booking request"), notes: [d.note, d.notes].filter(Boolean).join(". ") || undefined, quote: d.quote ?? d.rate };
}

export async function executeTool(block: { name: string; input: unknown }, ctx: ToolContext): Promise<ToolEvent> {
  const { store, tenant, agent, conversation } = ctx;
  const input = (block.input ?? {}) as Record<string, unknown>;
  const ev = (outcome: ToolEvent["outcome"], result: string): ToolEvent => ({ tool: block.name, input, outcome, result });

  const ct = ctx.connectorTools?.get(block.name);
  if (ct) return runConnectorTool(ct, input, ctx, ev);

  // A booking request always goes to the team as a request; the agent never books.
  if (isBookingRequest(block.name, input) && agent.boundaries.allowedTools.includes("capture_lead")) {
    return executeTool({ name: "capture_lead", input: bookingInput(block.name, input) }, ctx);
  }

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
      const hits = await searchKnowledge(store, tenant, String(input.query ?? ""));
      if (!hits.length) return ev("ran", "No matching knowledge found. Do not guess; offer to check with the team.");
      return ev("ran", hits.map((h) => `## ${h.title}\n${h.content}`).join("\n\n"));
    }
    case "capture_lead": {
      const str = (k: string) => (typeof input[k] === "string" && String(input[k]).trim() ? String(input[k]).trim().slice(0, 500) : undefined);
      const contact = Object.fromEntries(Object.entries({ name: str("name"), email: str("email"), phone: str("phone") }).filter(([, v]) => v)) as Conversation["contact"];
      await store.setConversationContact(tenant.id, conversation.id, contact);
      const known = { ...conversation.contact, ...contact };
      // The same chat's request is updated, not duplicated.
      const before = (await store.listMessages(tenant.id, conversation.id)).some((m) =>
        ((m.meta?.toolEvents as ToolEvent[] | undefined) ?? []).some((e) => e.tool === "capture_lead" && e.outcome === "ran")
      );
      if (!before) await store.recordOutcome(tenant.id, { agentId: agent.id, kind: "lead", value: 0, note: `${input.name}: ${input.interest}` });
      // Ties the lead to its chat, so A/B tests can compare personas.
      await store.audit(tenant.id, { actorType: "agent", actor: agent.name, action: before ? "lead.updated" : "lead.captured", detail: { conversationId: conversation.id } });
      notify(tenant, "lead_captured", { lead: input, conversationId: conversation.id, agent: agent.name, update: before });
      const guests = Number(input.guests);
      const sent = await sendBookingRequest(tenant, {
        conversationId: conversation.id,
        channel: conversation.channel,
        agent: agent.name,
        contact: known,
        villa: str("villa"),
        checkIn: str("check_in"),
        checkOut: str("check_out"),
        guests: Number.isFinite(guests) && guests > 0 ? Math.round(guests) : undefined,
        quote: str("quote"),
        notes: [str("interest"), str("notes")].filter(Boolean).join(". ") || undefined,
        about: input.about === "property_management" ? "property_management" : "stay",
        update: before,
      });
      // The back office couldn't take it: the managers get it as a request to review instead, so it's never lost.
      if (sent === "failed") {
        const who = [known.name, known.email, known.phone].filter(Boolean).join(", ");
        const a = await store.createApproval(tenant.id, {
          agentId: agent.id,
          conversationId: conversation.id,
          kind: "action",
          action: "booking_request",
          summary: `Booking request to follow up: ${who || "guest"}. ${[str("villa"), str("check_in") && `${str("check_in")} to ${str("check_out") ?? "?"}`, input.guests && `${input.guests} guests`, str("quote"), str("notes")].filter(Boolean).join(", ")}`.slice(0, 500),
          payload: { ...input, contact: known },
        });
        notify(tenant, "approval_requested", { approval: a });
      }
      const missing = !known.email && !known.phone ? " They gave no email or phone yet: ask for one so the team can reach them, then call this again." : "";
      return ev(
        "ran",
        sent === "saved"
          ? `${before ? "Request updated" : "Request saved"} in the team's ${input.about === "property_management" ? "leads" : "bookings"} list and staff alerted. Nothing was sent to the customer and nothing is booked or confirmed: tell them the team will contact them to confirm.${missing}`
          : `Details saved and the team notified. Nothing is booked or confirmed: tell them the team will contact them.${missing}`
      );
    }
    case "end_chat": {
      await store.setConversationStatus(tenant.id, conversation.id, "closed");
      await store.audit(tenant.id, { actorType: "agent", actor: agent.name, action: "chat.closed", detail: { conversationId: conversation.id, summary: String(input.summary ?? "").slice(0, 300) } });
      return ev("ran", "Chat closed. Your goodbye is the last message.");
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
    case "look_up_history": {
      const who = String(input.who ?? "").trim().toLowerCase();
      if (who.length < 3) return ev("error", "Give a name, email or phone.");
      const digits = who.replace(/\D/g, "");
      const convs = (await store.listConversations(tenant.id, 150))
        .filter((c) => c.id !== conversation.id && c.channel !== "ops")
        .filter((c) => {
          const k = c.contact;
          return (k.name && k.name.toLowerCase().includes(who)) || (k.email && k.email.toLowerCase() === who) || (digits.length >= 7 && k.phone?.replace(/\D/g, "").endsWith(digits.slice(-7)));
        })
        .slice(0, 3);
      if (!convs.length) return ev("ran", "No past conversations with them in Wally. Check the business's own records (your connector tools) instead.");
      const parts = await Promise.all(
        convs.map(async (c) => {
          const msgs = (await store.listMessages(tenant.id, c.id)).filter((m) => m.role === "user" || m.role === "assistant" || m.role === "staff").slice(-12);
          const contact = [c.contact.name, c.contact.email, c.contact.phone].filter(Boolean).join(", ");
          return `## ${c.channel} chat, ${c.createdAt.slice(0, 10)} (${contact})\n${msgs.map((m) => `${m.role === "user" ? "Them" : m.role === "staff" ? "Team" : "AI"}: ${m.content.slice(0, 400)}`).join("\n")}`;
        })
      );
      return ev("ran", parts.join("\n\n"));
    }
    case "draft_message": {
      const channel = input.channel === "whatsapp" || input.channel === "sms" ? input.channel : "email";
      const body = String(input.body ?? "").trim();
      if (!body) return ev("error", "Write the message itself in body.");
      const a = await createDraft(store, tenant, agent, conversation.id, {
        channel,
        to: String(input.to ?? "").trim().slice(0, 200),
        toName: input.to_name ? String(input.to_name).slice(0, 100) : undefined,
        subject: input.subject ? String(input.subject).slice(0, 200) : undefined,
        body: body.slice(0, 8000),
        about: String(input.about ?? "a message").slice(0, 200),
        documentIds: Array.isArray(input.document_ids) ? input.document_ids.map(String) : undefined,
      });
      return ev("sent_for_approval", `Draft saved (${a.id}) and sent to the team to check and approve. Show the person you're talking to the draft text, and say it goes out once approved (they can edit it first).`);
    }
    case "ask_colleague":
      return askColleague(String(input.colleague ?? ""), String(input.question ?? ""), ctx, ev);
    case "message_staff": {
      const to = String(input.to ?? "").trim();
      const text = String(input.text ?? "").trim();
      if (!to || !text) return ev("error", "Say who the message is for and what it says.");
      // An AI colleague isn't a person to text: ask them and get the answer now.
      const colleague = findColleague((await store.listAgents(tenant.id)).filter((a) => a.id !== agent.id), to);
      if (colleague) return askColleague(colleague.name, text, ctx, ev);
      const sent = await messageStaff(tenant, { agent: agent.name, to, text, conversationId: conversation.id, kind: "message" });
      return sent ? ev("ran", `Sent to ${to}.`) : ev("error", "No staff channel is set up for this business yet (back office alerts or Slack). Put the message in your reply instead.");
    }
    case "add_follow_up": {
      const dueAt = dueAtFrom(String(input.due ?? ""), tenant.timezone);
      if (!dueAt) return ev("error", "Give the due time as YYYY-MM-DD or YYYY-MM-DD HH:MM.");
      const t = await store.createTask(tenant.id, {
        agentId: agent.id,
        conversationId: conversation.id,
        title: String(input.title ?? "").slice(0, 200),
        detail: input.detail ? String(input.detail).slice(0, 1000) : null,
        assignee: String(input.assignee ?? MANAGERS).slice(0, 80),
        dueAt,
      });
      const when = whenIn(dueAt, tenant.timezone);
      const sent = await messageStaff(tenant, { agent: agent.name, to: t.assignee, text: `New follow-up: "${t.title}", by ${when}.${t.detail ? ` ${t.detail}` : ""}`, conversationId: conversation.id, taskId: t.id, kind: "follow_up" });
      return ev("ran", `Follow-up ${t.id} set for ${t.assignee}, due ${when}.${sent ? " They've been told." : " No staff channel is set up, so tell them in your reply."}`);
    }
    case "send_email": {
      const to = splitAddresses(input.to);
      if (!to.length) return ev("error", "Give at least one valid email address.");
      if (!(await emailConfigured(tenant.id))) return ev("error", "This business has no mailbox set up for AI staff yet. Say the team will email them, or escalate.");
      const docIds = Array.isArray(input.document_ids) ? input.document_ids.map(String) : [];
      try {
        const r = await sendOrAsk(store, tenant, agent, conversation.id, { to, subject: String(input.subject ?? "").slice(0, 200), text: String(input.body ?? ""), documentIds: docIds });
        return ev(r.outcome, r.result);
      } catch (err) {
        return ev("error", `The email couldn't be sent (${err instanceof Error ? err.message : "error"}).`);
      }
    }
    case "add_calendar_entry": {
      const to = splitAddresses(input.attendees);
      const start = dueAtFrom(String(input.start ?? ""), tenant.timezone);
      if (!to.length || !start) return ev("error", "Give attendees' email addresses and a start as YYYY-MM-DD HH:MM.");
      if (!(await emailConfigured(tenant.id))) return ev("error", "This business has no mailbox set up yet, so invites can't be sent. Use add_follow_up or tell the team instead.");
      const minutes = Math.min(24 * 60, Math.max(5, Number(input.minutes) || 60));
      const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
      const title = String(input.title ?? "").slice(0, 200);
      const when = whenIn(start, tenant.timezone);
      try {
        const r = await sendOrAsk(store, tenant, agent, conversation.id, {
          to,
          subject: `Invitation: ${title}, ${when}`,
          text: `${title}\n${when} (${minutes} minutes)${input.location ? `\n${input.location}` : ""}${input.notes ? `\n\n${input.notes}` : ""}\n\n${agent.name}, ${tenant.name}`,
          invite: { title, startUtc: start, endUtc: end, location: input.location ? String(input.location) : undefined, notes: input.notes ? String(input.notes) : undefined },
        });
        return ev(r.outcome, r.result);
      } catch (err) {
        return ev("error", `The invite couldn't be sent (${err instanceof Error ? err.message : "error"}).`);
      }
    }
    case "create_document": {
      const kind = input.kind === "excel" || input.kind === "letter" ? input.kind : "word";
      const title = String(input.title ?? "Document").slice(0, 150);
      try {
        const content =
          kind === "excel"
            ? await buildExcel(tenant, { title, sheets: (Array.isArray(input.sheets) ? input.sheets : []) as Sheet[] })
            : await buildWord(tenant, {
                title,
                body: String(input.body ?? ""),
                letter: kind === "letter" ? { to: input.to ? String(input.to) : undefined, signOff: input.sign_off ? String(input.sign_off) : `Kind regards,\n${agent.name}\n${tenant.name}` } : undefined,
              });
        const doc = await saveDocument(store, tenant.id, { agentId: agent.id, title, kind, content });
        const link = await documentLink(doc);
        return ev("ran", `Created ${doc.filename} (id ${doc.id}).${link ? ` Download link, valid ${LINK_DAYS} days: ${link}` : ""} Attach it to an email with send_email, or share the link with message_staff.`);
      } catch (err) {
        return ev("error", `The document couldn't be created (${err instanceof Error ? err.message : "error"}).`);
      }
    }
    case "list_follow_ups":
      return ev("ran", describeTasks(await store.listTasks(tenant.id, "open"), tenant.timezone));
    case "close_follow_up": {
      const id = String(input.id ?? "");
      const t = (await store.listTasks(tenant.id, "open")).find((x) => x.id === id || x.id.startsWith(id));
      if (!t) return ev("error", "No open follow-up with that id. Use list_follow_ups.");
      await store.updateTask(tenant.id, t.id, { status: input.cancelled ? "cancelled" : "done", doneAt: new Date().toISOString(), doneNote: input.note ? String(input.note).slice(0, 500) : null });
      return ev("ran", `Closed "${t.title}".`);
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
    return ev("ran", await callConnectorTool(ct.connector, ct.tool.name, input, agent.name));
  } catch (err) {
    return ev("error", `${ct.connector.name} couldn't do that right now (${err instanceof Error ? err.message : "error"}). Offer to have the team follow up.`);
  }
}

// One agent asks another and waits for the answer. A colleague answering
// can't ask a third, so questions never loop.
async function askColleague(name: string, question: string, ctx: ToolContext, ev: (o: ToolEvent["outcome"], r: string) => ToolEvent) {
  const { store, tenant, agent } = ctx;
  if (ctx.depth) return ev("error", "You're answering a colleague's question: answer from what you know and your own tools.");
  const team = (await store.listAgents(tenant.id)).filter((a) => a.id !== agent.id && a.status === "live");
  const target = findColleague(team, name);
  if (!target) return ev("error", `No AI colleague called ${name}. Your colleagues: ${team.map((a) => a.name).join(", ") || "none"}.`);
  if (!question.trim()) return ev("error", "Say what you need from them.");
  if (ctx.dryRun) return ev("ran", `(Test) ${target.name} answered.`);
  const key = `${agent.id.slice(0, 8)}.asks.${target.id.slice(0, 8)}@team.wally`;
  const conversation =
    (await store.findOpenConversation(tenant.id, "ops", key)) ??
    (await store.createConversation(tenant.id, { agentId: target.id, channel: "ops", contact: { name: `${agent.name} (AI colleague)`, email: key }, variant: null }));
  const run = await runAgent({
    store,
    tenant,
    agent: target,
    conversation,
    text: `[Question from ${agent.name}, your AI colleague${agent.title ? ` (${agent.title})` : ""}, working for the team] ${question.slice(0, 2000)}`,
    depth: 1,
  });
  await store.audit(tenant.id, { actorType: "agent", actor: agent.name, action: "colleague.asked", detail: { colleague: target.name, conversationId: conversation.id, question: question.slice(0, 300) } });
  return ev("ran", `${target.name} answered: ${run.reply}`);
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
  /** Set when a colleague asked: this agent can't ask a colleague in turn. */
  depth?: number;
  /** A person was asked to join but hasn't replied yet: the agent keeps helping meanwhile. */
  waitingForPerson?: boolean;
}): Promise<AgentRun> {
  const { store, tenant, conversation, text, dryRun, depth, waitingForPerson } = args;
  const agent = await withVariant(store, args.agent, conversation.variant);
  const empty = { toolEvents: [], model: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  await store.addMessage(tenant.id, { conversationId: conversation.id, role: "user", content: text });
  if (!dryRun) notify(tenant, "message_received", { conversationId: conversation.id, channel: conversation.channel, contact: conversation.contact, text, ...(waitingForPerson ? { waitingHuman: true } : {}) });

  const finish = async (run: AgentRun) => {
    await store.addMessage(tenant.id, {
      conversationId: conversation.id,
      role: "assistant",
      content: run.reply,
      meta: { toolEvents: run.toolEvents, model: run.model, mode: run.mode, costUsd: run.costUsd, agent: agent.name, agentId: agent.id },
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
  const team = await store.listAgents(tenant.id);
  const system = `${buildSystemPrompt(tenant, agent, team)}${
    waitingForPerson
      ? "\n\nA team member has been asked to join this chat and hasn't replied yet. Keep helping with what you can, and say they'll join here soon; don't call escalate_to_human again."
      : ""
  }`;
  const connectorTools = await connectorToolsFor(store, tenant.id, agent);
  const tools = [
    ...TOOLS.filter(
      (t) => t.name === "request_approval" || t.name === "escalate_to_human" || (t.name === "end_chat" && !worksWithTeam(agent)) || agent.boundaries.allowedTools.includes(t.name)
    ),
    ...(worksWithTeam(agent) ? [...OFFICE_TOOL_DEFS, ...PAPERWORK_TOOL_DEFS] : []),
    EMAIL_TOOL_DEF,
    ...DRAFT_TOOL_DEFS,
    ...(!depth && team.some((a) => a.id !== agent.id && a.status === "live") ? [COLLEAGUE_TOOL_DEF] : []),
    ...asModelTools(connectorTools),
  ];
  const history = await store.listMessages(tenant.id, conversation.id);
  const ctx = { store, tenant, agent, conversation, dryRun, connectorTools, depth };

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
