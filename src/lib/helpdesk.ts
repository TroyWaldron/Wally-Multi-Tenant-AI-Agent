// The helpdesk: a business's own team writing to the Wally team (a problem
// with an AI staff member, a request to hire another, a question). Stored as
// conversations on their own channel so it reuses messages and statuses:
// "waiting_human" means waiting on the Wally team, "open" means Wally has
// answered, "closed" means done. No agent ever answers these.
import type { Store } from "@/lib/store/types";
import type { Conversation } from "@/lib/types";

export const HELPDESK_CHANNEL = "helpdesk";

export const HELPDESK_TOPICS = ["problem", "hire", "question"] as const;
export type HelpdeskTopic = (typeof HELPDESK_TOPICS)[number];

export function isHelpdesk(c: Conversation | null): c is Conversation {
  return Boolean(c && c.channel === HELPDESK_CHANNEL);
}

/** A message from the business. Opens a ticket when there isn't one. */
export async function helpdeskFromBusiness(store: Store, tenantId: string, args: { ticket?: Conversation; text: string; by: string; topic?: HelpdeskTopic }) {
  const ticket =
    args.ticket ??
    (await store.createConversation(tenantId, { agentId: null, channel: HELPDESK_CHANNEL, contact: { name: args.by } }));
  await store.addMessage(tenantId, { conversationId: ticket.id, role: "user", content: args.text, meta: { by: args.by, topic: args.topic } });
  await store.setConversationStatus(tenantId, ticket.id, "waiting_human");
  return ticket;
}

/** The Wally team's answer. */
export async function helpdeskFromWally(store: Store, tenantId: string, ticket: Conversation, text: string, by: string) {
  await store.addMessage(tenantId, { conversationId: ticket.id, role: "staff", content: text, meta: { by } });
  if (ticket.status !== "closed") await store.setConversationStatus(tenantId, ticket.id, "open");
}
