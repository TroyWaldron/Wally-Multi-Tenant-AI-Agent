// Inbound from n8n. n8n authenticates with the business's slug and shared
// secret (Settings -> n8n), then asks Wally to do one of:
//   { action: "message", channel, contact, text, agentId? }  -> runs the agent, returns its reply
//   { action: "event", event, data }                        -> an event from another system (e.g. booking_created); AI staff who react to it get to work
//   { action: "approval", approvalAction, summary, payload } -> puts something in the approval inbox
//   { action: "staff_reply", conversationId, text }          -> records a human reply (e.g. staff answered on WhatsApp)
import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleInbound, InboundError } from "@/lib/agent/inbound";
import { reactToEvent, receiveEvent } from "@/lib/events";
import { notify } from "@/lib/n8n";
import { safeEqual } from "@/lib/secrets";
import { systemStore } from "@/lib/session";
import { getConfig } from "@/lib/settings";

const contact = z.object({ name: z.string().optional(), phone: z.string().optional(), email: z.string().optional() }).optional();
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), channel: z.string().default("whatsapp"), text: z.string(), contact, agentId: z.string().optional(), conversationId: z.string().optional() }),
  z.object({ action: z.literal("event"), event: z.string(), data: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ action: z.literal("approval"), approvalAction: z.string(), summary: z.string(), payload: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ action: z.literal("staff_reply"), conversationId: z.string(), text: z.string(), staffName: z.string().optional() }),
]);

export async function POST(req: NextRequest) {
  const slug = req.headers.get("x-wally-tenant") ?? "";
  const secret = req.headers.get("x-wally-secret") ?? "";
  const store = systemStore();
  const tenant = slug ? await store.getTenantBySlug(slug) : null;
  const expected = tenant ? await getConfig(tenant.id, "N8N_SECRET") : undefined;
  if (!tenant || !expected || !safeEqual(secret, expected)) {
    return NextResponse.json({ error: "Unknown business or wrong secret. Send X-Wally-Tenant and X-Wally-Secret headers." }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const body = parsed.data;

  try {
    switch (body.action) {
      case "message": {
        const result = await handleInbound({ store, tenant, channel: body.channel, text: body.text, contact: body.contact, agentId: body.agentId, conversationId: body.conversationId });
        return NextResponse.json(result);
      }
      case "event": {
        const { outcome, agents } = await receiveEvent(store, tenant, body.event, body.data, "n8n");
        if (agents.length) after(() => reactToEvent(store, tenant, body.event, body.data, agents.map((a) => a.id)));
        return NextResponse.json({ ok: true, recordedOutcome: outcome, reactingAgents: agents.map((a) => a.name) });
      }
      case "approval": {
        const a = await store.createApproval(tenant.id, { agentId: null, conversationId: null, kind: "action", action: body.approvalAction, summary: body.summary, payload: body.payload });
        notify(tenant, "approval_requested", { approval: a });
        return NextResponse.json({ ok: true, approvalId: a.id });
      }
      case "staff_reply": {
        const conv = await store.getConversation(tenant.id, body.conversationId);
        if (!conv) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
        await store.addMessage(tenant.id, { conversationId: conv.id, role: "staff", content: body.text, meta: { by: body.staffName ?? "staff" } });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (err) {
    if (err instanceof InboundError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("n8n inbound failed", err);
    return NextResponse.json({ error: "Something went wrong processing this request." }, { status: 500 });
  }
}
