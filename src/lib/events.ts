// Business events from a client's own systems (a booking is made, a payment
// comes in). Each one is logged, counted as an outcome where it is one, and
// handed to every live AI staff member who reacts to it (Agents > Reacts to).
// That agent works it like a task from the team: it can look things up, use
// its tools and connectors, and ask for approval; what it concludes goes to
// the team's Slack alert channel.
import { handleInbound } from "@/lib/agent/inbound";
import { BUSINESS_EVENTS } from "@/lib/businessEvents";
import { BACK_OFFICE } from "@/lib/team";
import { slackApi, slackConfig } from "@/lib/slack";
import type { Store } from "@/lib/store/types";
import type { Tenant } from "@/lib/types";


/** An agent with nothing to add answers with this and nobody is pinged. */
const QUIET = "NOTHING_TO_DO";

const labelOf = (event: string) => BUSINESS_EVENTS.find((e) => e.event === event)?.label ?? event.replace(/_/g, " ");

export async function receiveEvent(store: Store, tenant: Tenant, event: string, data: Record<string, unknown>, source: string) {
  await store.audit(tenant.id, { actorType: source === "n8n" ? "n8n" : "system", actor: source, action: `event.${event}`, detail: data });
  const outcome = BUSINESS_EVENTS.find((e) => e.event === event)?.outcome ?? null;
  if (outcome) {
    const value = Number(data.total ?? data.amount ?? 0) || 0;
    await store.recordOutcome(tenant.id, { agentId: null, kind: outcome, value, note: `From ${event}` });
  }
  const agents = (await store.listAgents(tenant.id)).filter((a) => a.status === "live" && a.boundaries.reactsTo?.includes(event));
  return { outcome, agents };
}

/** Runs each reacting agent on the event. Call inside after(): it can take a while. */
export async function reactToEvent(store: Store, tenant: Tenant, event: string, data: Record<string, unknown>, agentIds: string[]) {
  const day = new Date().toISOString().slice(0, 10);
  const details = JSON.stringify(data, null, 1).slice(0, 3000);
  for (const agentId of agentIds) {
    try {
      const r = await handleInbound({
        store,
        tenant,
        channel: BACK_OFFICE,
        agentId,
        // One back-office chat per agent per day keeps the history short.
        contact: { name: "Business events", email: `events.${agentId.slice(0, 8)}.${day}@wally` },
        text:
          `[Business event from the ${tenant.name} system: ${labelOf(event)}]\n${details}\n\n` +
          `Do whatever your role calls for with this, using your tools. Then write one or two plain lines for the team saying what you did or what they should do. ` +
          `If it needs nothing from you or them, reply only ${QUIET}.`,
      });
      const reply = r.reply?.trim() ?? "";
      const quiet = !reply || reply.includes(QUIET);
      const agent = (await store.listAgents(tenant.id)).find((a) => a.id === agentId);
      await store.audit(tenant.id, { actorType: "agent", actor: agent?.name ?? agentId, action: "event.reaction", detail: { event, agentId, conversationId: r.conversationId, quiet, reply: reply.slice(0, 500) } });
      if (!quiet) await postEventNote(tenant, agent?.name ?? "AI staff", labelOf(event), reply);
    } catch (err) {
      console.error(`agent ${agentId} failed to react to ${event}:`, err);
    }
  }
}

async function postEventNote(tenant: Pick<Tenant, "id">, agentName: string, label: string, text: string) {
  const { token, alertChannel } = await slackConfig(tenant.id);
  if (!token || !alertChannel) return;
  await slackApi(token, "chat.postMessage", { channel: alertChannel, text: `:zap: *${label}*\n*${agentName}:* ${text.slice(0, 2500)}` });
}
