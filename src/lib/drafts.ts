// Drafts: an AI staff member looks at what's on file (enquiries, bookings,
// past chats, knowledge) and writes a message or email for someone. A person
// reads it, can change the wording, and approves; then it goes out, by email
// from the business's mailbox or through n8n (WhatsApp, SMS), or the team
// sends it themselves.
import { emailConfigured, splitAddresses } from "@/lib/email";
import { notify } from "@/lib/n8n";
import { deliver } from "@/lib/officeMail";
import type { Store } from "@/lib/store/types";
import type { Agent, Tenant } from "@/lib/types";
export { editableOf } from "@/lib/draftText";

export type Draft = {
  channel: "email" | "whatsapp" | "sms";
  /** Email address or phone number; may be blank when only the name is known. */
  to: string;
  toName?: string;
  subject?: string;
  body: string;
  /** Why it's being sent, in a few words, for the person approving it. */
  about: string;
  documentIds?: string[];
};

export type DraftEdits = { subject?: string; body?: string };

/** Applies a person's wording changes before the approval runs. */
export function withEdits(payload: Record<string, unknown>, edits?: DraftEdits) {
  if (!edits || (edits.body === undefined && edits.subject === undefined)) return payload;
  const clean = (s?: string) => (s === undefined ? undefined : s.slice(0, 8000));
  if (payload.draft) {
    const d = payload.draft as Draft;
    return { ...payload, draft: { ...d, body: clean(edits.body) ?? d.body, subject: clean(edits.subject) ?? d.subject } };
  }
  if (payload.email) {
    const e = payload.email as { subject: string; text: string };
    return { ...payload, email: { ...e, text: clean(edits.body) ?? e.text, subject: clean(edits.subject) ?? e.subject } };
  }
  return payload;
}

export async function createDraft(store: Store, tenant: Tenant, agent: Agent, conversationId: string | null, draft: Draft) {
  const who = draft.toName || draft.to || "someone";
  const a = await store.createApproval(tenant.id, {
    agentId: agent.id,
    conversationId,
    kind: "action",
    action: "send_draft",
    summary: `${agent.name} drafted a ${draft.channel === "email" ? "email" : draft.channel === "sms" ? "text message" : "WhatsApp message"} to ${who}: ${draft.about}`,
    payload: { draft },
  });
  // approval_requested alerts the team (phone, Slack, review link); draft_ready lets n8n route drafts on their own.
  notify(tenant, "approval_requested", { approval: a });
  notify(tenant, "draft_ready", { approvalId: a.id, agent: agent.name, draft });
  await store.audit(tenant.id, { actorType: "agent", actor: agent.name, action: "draft.created", detail: { approvalId: a.id, channel: draft.channel, to: draft.to, about: draft.about } });
  return a;
}

/** Sends an approved draft. Email goes from the business mailbox when there is one; everything else goes to n8n. */
export async function sendDraft(store: Store, tenant: Tenant, approvalId: string, draft: Draft, actor: string): Promise<string> {
  const emails = draft.channel === "email" ? splitAddresses(draft.to) : [];
  if (emails.length && (await emailConfigured(tenant.id))) {
    await deliver(store, tenant, { to: emails, subject: draft.subject || draft.about, text: draft.body, documentIds: draft.documentIds });
    await store.audit(tenant.id, { actorType: "user", actor, action: "draft.sent", detail: { approvalId, channel: "email", to: emails } });
    return `emailed to ${emails.join(", ")}`;
  }
  notify(tenant, "draft_approved", { approvalId, approvedBy: actor, draft });
  await store.audit(tenant.id, { actorType: "user", actor, action: "draft.approved", detail: { approvalId, channel: draft.channel, to: draft.to } });
  return draft.to ? `passed to n8n to send by ${draft.channel}` : "approved; the team sends it (no address on file)";
}
