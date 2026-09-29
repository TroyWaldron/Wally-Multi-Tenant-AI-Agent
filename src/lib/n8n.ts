// Outbound calls to a tenant's n8n instance. Two kinds:
// - events: fire-and-forget notifications ({ event, tenant, data, sentAt }),
//   for WhatsApp replies, staff alerts, sheet syncs.
// - workflows: an agent asks n8n to do something and waits for the answer
//   (the workflow ends in a "Respond to Webhook" node).
// Both carry X-Wally-Secret so the workflow's first node can reject forgeries.
import { after } from "next/server";
import { getConfig } from "@/lib/settings";
import { approvalLink } from "@/lib/approvalLinks";
import { alertSlack, postApprovalToSlack } from "@/lib/slack";
import type { Conversation, Tenant } from "@/lib/types";

export const N8N_EVENTS = [
  { event: "conversation_started", when: "A new conversation opens on any channel" },
  { event: "message_received", when: "A customer sends a message" },
  { event: "agent_replied", when: "An agent sends a reply (n8n delivers it on WhatsApp, email, SMS)" },
  { event: "approval_requested", when: "An agent needs a human decision" },
  { event: "approval_decided", when: "Someone approves or rejects in the inbox" },
  { event: "escalated", when: "An agent hands a conversation to a person" },
  { event: "draft_ready", when: "An agent drafted a message or email for a person to approve" },
  { event: "draft_approved", when: "A draft was approved: n8n sends it (WhatsApp, SMS, or email when Wally has no mailbox)" },
  { event: "lead_captured", when: "An agent captures a new lead" },
  { event: "outcome_recorded", when: "An outcome is logged (booking, lead, ticket closed...)" },
  { event: "budget_exceeded", when: "An agent hits its monthly budget and pauses" },
  { event: "test_ping", when: "You press Send test event in Settings" },
] as const;

export type N8nEvent = (typeof N8N_EVENTS)[number]["event"];

type Result = { ok: boolean; status?: number; body?: unknown; error?: string };

async function post(tenant: Pick<Tenant, "id" | "slug" | "name">, body: Record<string, unknown>, timeoutMs: number): Promise<Result> {
  const [url, secret] = await Promise.all([getConfig(tenant.id, "N8N_WEBHOOK_URL"), getConfig(tenant.id, "N8N_SECRET")]);
  if (!url) return { ok: false, error: "No n8n webhook URL is set for this business." };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { "X-Wally-Secret": secret } : {}) },
      body: JSON.stringify({ ...body, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, sentAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // n8n answered with plain text; keep it as-is.
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Request failed." };
  }
}

/** Awaitable send; used by the Settings test button so it can show what came back. */
export function sendEvent(tenant: Pick<Tenant, "id" | "slug" | "name">, event: N8nEvent, data: Record<string, unknown>) {
  return post(tenant, { kind: "event", event, data }, 10_000);
}

/** Sends after the response so a slow n8n never delays a guest's reply. */
export function notify(tenant: Pick<Tenant, "id" | "slug" | "name">, event: N8nEvent, data: Record<string, unknown>) {
  const approval = data.approval as { id?: string; kind?: string; summary?: string; action?: string } | undefined;
  // A one-tap review link rides along, so n8n can put it in an email or WhatsApp message.
  const reviewUrl = event === "approval_requested" && approval?.id && approval.kind === "action" ? approvalLink(tenant.id, approval.id) : null;
  if (reviewUrl) data = { ...data, reviewUrl };
  after(async () => {
    const r = await sendEvent(tenant, event, data);
    if (!r.ok && !r.error?.startsWith("No n8n webhook URL")) console.error(`n8n ${event} failed:`, r.error ?? `HTTP ${r.status}`);
  });
  if (event === "approval_requested" && approval?.id && approval.kind === "action") {
    const a = { id: approval.id, summary: approval.summary ?? "", action: approval.action ?? "" };
    after(() => postApprovalToSlack(tenant, a).catch((err) => console.error("slack approval failed", err)));
    if (reviewUrl) after(() => alertBackOffice(tenant, event, { ...data, reviewUrl }));
  }
  if (needsPerson(event, data)) {
    after(() => alertBackOffice(tenant, event, data));
    if (data.conversationId) after(() => alertSlack(tenant, event === "escalated" ? "needs_person" : "guest_message", slackAlertOf(data)).catch((err) => console.error("slack alert failed", err)));
  }
}

// A guest is waiting for a person: the agent handed over, or the guest wrote
// again while the team has the chat.
function needsPerson(event: N8nEvent, data: Record<string, unknown>) {
  return event === "escalated" || (event === "message_received" && data.waitingHuman === true);
}

// Tells the business's own back office (for example Sunsational's Operations
// Hub, which then alerts staff phones). Signed with the Website relay secret.
async function alertBackOffice(tenant: Pick<Tenant, "id">, event: N8nEvent, data: Record<string, unknown>) {
  const [url, secret] = await Promise.all([getConfig(tenant.id, "BACKOFFICE_ALERT_URL"), getConfig(tenant.id, "WIDGET_RELAY_SECRET")]);
  if (!url || !secret) return;
  const approval = data.approval as { summary?: string; payload?: { contact?: unknown } } | undefined;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Wally-Relay-Secret": secret },
      body: JSON.stringify({
        event: event === "approval_requested" ? "approval_needed" : event === "escalated" ? "needs_person" : "guest_message",
        reviewUrl: data.reviewUrl,
        conversationId: data.conversationId,
        channel: data.channel,
        contact: data.contact ?? approval?.payload?.contact ?? {},
        text: typeof data.text === "string" ? data.text.slice(0, 200) : approval?.summary?.slice(0, 200),
        sentAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`back office alert ${event} failed: HTTP ${res.status}`);
  } catch (err) {
    console.error(`back office alert ${event} failed:`, err);
  }
}

function slackAlertOf(data: Record<string, unknown>) {
  const approval = data.approval as { summary?: string; payload?: { contact?: Conversation["contact"] } } | undefined;
  const contact = ((data.contact as Conversation["contact"] | undefined) ?? approval?.payload?.contact ?? {}) as Conversation["contact"];
  return {
    conversationId: String(data.conversationId ?? ""),
    channel: typeof data.channel === "string" ? data.channel : undefined,
    who: contact.name || contact.phone || contact.email,
    text: typeof data.text === "string" ? data.text.slice(0, 300) : approval?.summary?.slice(0, 300),
  };
}

/** Runs a named workflow and returns n8n's JSON answer to the agent. */
export function runWorkflow(tenant: Pick<Tenant, "id" | "slug" | "name">, workflow: string, input: Record<string, unknown>, context: Record<string, unknown>) {
  return post(tenant, { kind: "workflow", workflow, input, context }, 25_000);
}

export type BookingRequest = {
  conversationId: string;
  channel: string;
  agent: string;
  contact: Conversation["contact"];
  villa?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  quote?: string;
  notes?: string;
  /** A guest's stay (the default) or a property owner asking about management. */
  about: "stay" | "property_management";
  /** True when the agent sent this chat's request before and this corrects it. */
  update: boolean;
};

/**
 * Puts a customer's booking request into the business's own back office
 * (Sunsational's Bookings list), so a person, or the coordinator, follows it
 * up. Nothing is sent to the customer. Says whether the back office saved it,
 * or that the business has no back office linked.
 */
export async function sendBookingRequest(tenant: Pick<Tenant, "id">, r: BookingRequest): Promise<"saved" | "failed" | "no_back_office"> {
  const [url, secret] = await Promise.all([getConfig(tenant.id, "BACKOFFICE_ALERT_URL"), getConfig(tenant.id, "WIDGET_RELAY_SECRET")]);
  if (!url || !secret) return "no_back_office";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Wally-Relay-Secret": secret },
      body: JSON.stringify({ event: "booking_request", ...r, sentAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`back office booking request failed: HTTP ${res.status}`);
    return res.ok ? "saved" : "failed";
  } catch (err) {
    console.error("back office booking request failed:", err);
    return "failed";
  }
}
