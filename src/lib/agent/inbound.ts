// One entry point for every channel: resolve the agent and conversation for
// a tenant, then run the agent. Channels differ only in how they find the
// tenant (widget key, WhatsApp phone_number_id, n8n secret, signed-in user).
import { after } from "next/server";
import { runAgent } from "@/lib/agent/runtime";
import { notify } from "@/lib/n8n";
import { pickVariant } from "@/lib/personas";
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
  // Asked for a specific agent: never continue a chat that belongs to another one.
  if (conversation && args.agentId && conversation.agentId && conversation.agentId !== args.agentId) conversation = null;

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
    // Playground chats always get the current persona, so tests stay predictable.
    const variant = channel === "playground" ? null : pickVariant(agent);
    conversation = await store.createConversation(tenant.id, { agentId: agent.id, channel, contact: args.contact ?? {}, variant });
    notify(tenant, "conversation_started", { conversationId: conversation.id, channel, contact: conversation.contact, agent: agent.name });
  }

  // A closed chat reopens when the customer writes again.
  if (conversation.status === "closed" && channel !== "ops") {
    await store.setConversationStatus(tenant.id, conversation.id, "open");
    conversation = { ...conversation, status: "open" };
  }

  // A person has the chat once they've replied: log the message, notify staff,
  // and let them answer. Until then the agent keeps helping.
  let waitingForPerson = false;
  if (conversation.status === "waiting_human" && channel !== "playground") {
    const personReplied = (await store.listMessages(tenant.id, conversation.id)).some((m) => m.role === "staff");
    if (personReplied) {
      await store.addMessage(tenant.id, { conversationId: conversation.id, role: "user", content: text });
      notify(tenant, "message_received", { conversationId: conversation.id, channel, contact: conversation.contact, text, waitingHuman: true });
      return { conversationId: conversation.id, reply: null, toolEvents: [], mode: "waiting_human" as const, closed: false };
    }
    waitingForPerson = true;
  }

  sweepQuietChats(store, tenant);
  const run = await runAgent({ store, tenant, agent, conversation, text, waitingForPerson });
  const closed = run.toolEvents.some((e) => e.tool === "end_chat" && e.outcome === "ran");
  return { conversationId: conversation.id, reply: run.reply, toolEvents: run.toolEvents, mode: run.mode, model: run.model, costUsd: run.costUsd, closed };
}

// Customer chats close after this long without a message.
export const QUIET_MINUTES = 30;
const CUSTOMER_CHANNELS = ["web", "whatsapp", "sms"];
const lastSweep = new Map<string, number>();

/**
 * Closes a business's customer chats that have gone quiet, at most every few
 * minutes per business, after the response. The Ops Hub and the daily cron
 * call it too, so chats close even on a quiet day.
 */
export function sweepQuietChats(store: Store, tenant: Pick<Tenant, "id">, force = false) {
  const now = Date.now();
  if (!force && now - (lastSweep.get(tenant.id) ?? 0) < 5 * 60_000) return;
  lastSweep.set(tenant.id, now);
  try {
    after(() => closeQuietChats(store, tenant).catch((err) => console.error("quiet chat sweep failed", err)));
  } catch {
    // Outside a request (a script or test): skip; the next request sweeps.
  }
}

export async function closeQuietChats(store: Store, tenant: Pick<Tenant, "id">) {
  const closed = await store.closeQuietConversations(tenant.id, CUSTOMER_CHANNELS, new Date(Date.now() - QUIET_MINUTES * 60_000).toISOString());
  for (const c of closed) {
    await store.audit(tenant.id, { actorType: "system", actor: "Wally", action: "chat.auto_closed", detail: { conversationId: c.id, channel: c.channel, quietMinutes: QUIET_MINUTES } });
  }
  return closed.length;
}
