// Sending an email (or calendar invite) an AI staff member wrote: straight
// away to staff, through the approval inbox to anyone else.
import { randomUUID } from "node:crypto";
import { allStaff, icsInvite, sendEmail, type EmailRequest } from "@/lib/email";
import { documentFile } from "@/lib/documents";
import { notify } from "@/lib/n8n";
import { getConfig } from "@/lib/settings";
import type { Store } from "@/lib/store/types";
import type { Agent, Tenant } from "@/lib/types";

export async function deliver(store: Store, tenant: Tenant, req: EmailRequest) {
  const docs = await Promise.all((req.documentIds ?? []).map((id) => store.getDocument(tenant.id, id)));
  const attachments = await Promise.all(docs.filter((d) => d !== null).map((d) => documentFile(d!)));
  let icalEvent: string | undefined;
  if (req.invite) {
    const organizer = (await getConfig(tenant.id, "EMAIL_FROM")) || (await getConfig(tenant.id, "SMTP_USER")) || "";
    icalEvent = icsInvite({ uid: randomUUID(), organizer, attendees: req.to, ...req.invite });
  }
  return sendEmail(tenant.id, { to: req.to, subject: req.subject, text: req.text, attachments, icalEvent });
}

/** Sends now when every recipient is staff, otherwise asks for approval. */
export async function sendOrAsk(store: Store, tenant: Tenant, agent: Agent, conversationId: string, req: EmailRequest): Promise<{ outcome: "ran" | "sent_for_approval"; result: string }> {
  if (await allStaff(tenant.id, req.to)) {
    await deliver(store, tenant, req);
    await store.audit(tenant.id, { actorType: "agent", actor: agent.name, action: req.invite ? "calendar.invited" : "email.sent", detail: { to: req.to, subject: req.subject, conversationId } });
    return { outcome: "ran", result: `Sent to ${req.to.join(", ")}.` };
  }
  const what = req.invite ? `a calendar invite "${req.invite.title}"` : `an email "${req.subject}"`;
  const a = await store.createApproval(tenant.id, {
    agentId: agent.id,
    conversationId,
    kind: "action",
    action: req.invite ? "send_invite" : "send_email",
    summary: `${agent.name} wants to send ${what} to ${req.to.join(", ")}:\n\n${req.text.slice(0, 600)}`,
    payload: { email: req },
  });
  notify(tenant, "approval_requested", { approval: a });
  return { outcome: "sent_for_approval", result: "It goes out once a person at the business approves it. Say so." };
}
