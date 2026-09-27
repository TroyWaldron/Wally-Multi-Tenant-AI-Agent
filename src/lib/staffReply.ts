import { notify } from "@/lib/n8n";
import type { Store } from "@/lib/store/types";
import type { Conversation, Tenant } from "@/lib/types";

/**
 * A person on the business's team answers a guest, from the Wally console or
 * the business's own back office. Replying takes the chat over so the agent
 * doesn't talk over the team; website guests see it in their chat, and n8n
 * delivers it on other channels (WhatsApp, email...).
 */
export async function sendStaffReply(store: Store, tenant: Tenant, conv: Conversation, text: string, by: string) {
  await store.addMessage(tenant.id, { conversationId: conv.id, role: "staff", content: text, meta: { by } });
  if (conv.status === "open") await store.setConversationStatus(tenant.id, conv.id, "waiting_human");
  notify(tenant, "agent_replied", { conversationId: conv.id, channel: conv.channel, contact: conv.contact, reply: text, agent: by, fromStaff: true });
}
