// One entry point for every channel: resolve the agent and conversation for
// a tenant, then run the agent. Channels differ only in how they find the
// tenant (widget key, WhatsApp phone_number_id, n8n secret, signed-in user).
import { runAgent } from "@/lib/agent/runtime";
import { notify } from "@/lib/n8n";
import { redactPII } from "@/lib/pii";
import type { Store } from "@/lib/store/types";
import type { Conversation, Tenant } from "@/lib/types";

export class InboundError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function handleInbound(args: {
  store: Store;
  tenant: Tenant;
  channel: string;
  text: string;
  agentId?: string | null;
  conversationId?: string | null;
  contact?: Conversation["contact"];
  /** Playground may talk to draft agents; public channels only reach live ones. */
  allowDraft?: boolean;
}) {
  const { store, tenant, channel } = args;
  // Card, bank and ID numbers never reach storage or a model provider.
  const text = redactPII(args.text.trim().slice(0, 4000)).text;
  if (!text) throw new InboundError("Message is empty.");

  let conversation = args.conversationId ? await store.getConversation(tenant.id, args.conversationId) : null;
  const contactKey = args.contact?.phone || args.contact?.email;
  if (!conversation && contactKey) conversation = await store.findOpenConversation(tenant.id, channel, contactKey);

  const agents = await store.listAgents(tenant.id);
  const agentId = args.agentId ?? conversation?.agentId;
  const agent =
    (agentId ? agents.find((a) => a.id === agentId) : undefined) ??
    agents.find((a) => a.status === "live" && a.channels.includes(channel)) ??
    // Back-office staff (channel "ops", like a coordinator) never answer
    // customers, even when no one else covers this channel.
    agents.find((a) => a.status === "live" && a.channels.some((c) => c !== "ops"));
  if (!agent) throw new InboundError("No live agent is set up for this channel.", 404);
  if (agent.status === "draft" && !args.allowDraft) throw new InboundError("This agent is not live yet.", 403);

  if (!conversation) {
    conversation = await store.createConversation(tenant.id, { agentId: agent.id, channel, contact: args.contact ?? {} });
    notify(tenant, "conversation_started", { conversationId: conversation.id, channel, contact: conversation.contact, agent: agent.name });
  }

  // A person has taken over: log the message, notify staff, and let them answer.
  if (conversation.status === "waiting_human" && channel !== "playground") {
    await store.addMessage(tenant.id, { conversationId: conversation.id, role: "user", content: text });
    notify(tenant, "message_received", { conversationId: conversation.id, channel, contact: conversation.contact, text, waitingHuman: true });
    return { conversationId: conversation.id, reply: null, toolEvents: [], mode: "waiting_human" as const };
  }

  const run = await runAgent({ store, tenant, agent, conversation, text });
  return { conversationId: conversation.id, reply: run.reply, toolEvents: run.toolEvents, mode: run.mode, model: run.model, costUsd: run.costUsd };
}
