import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleInbound, InboundError } from "@/lib/agent/inbound";
import { CORS_HEADERS, rateLimited } from "@/lib/cors";
import { systemStore } from "@/lib/session";
import { visitorOf } from "@/lib/widgetVisitor";

const Body = z.object({ key: z.string(), text: z.string().max(4000), conversationId: z.string().uuid().nullish() });

async function isWaiting(store: ReturnType<typeof systemStore>, tenantId: string, id: string) {
  return (await store.getConversation(tenantId, id))?.status === "waiting_human";
}

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: CORS_HEADERS });
  const store = systemStore();
  const tenant = await store.getTenantByPublicKey(parsed.data.key);
  if (!tenant) return NextResponse.json({ error: "Unknown widget key." }, { status: 404, headers: CORS_HEADERS });
  if (rateLimited(`${parsed.data.key}:${await visitorOf(req, tenant.id)}`)) {
    return NextResponse.json({ error: "Too many messages, please wait a minute." }, { status: 429, headers: CORS_HEADERS });
  }
  try {
    const r = await handleInbound({ store, tenant, channel: "web", text: parsed.data.text, conversationId: parsed.data.conversationId });
    // The widget only needs the reply; tool details stay in the console.
    return NextResponse.json({ conversationId: r.conversationId, reply: r.reply, waiting: r.mode === "waiting_human" || (await isWaiting(store, tenant.id, r.conversationId)), closed: r.closed ?? false }, { headers: CORS_HEADERS });
  } catch (err) {
    const status = err instanceof InboundError ? err.status : 500;
    const message = err instanceof InboundError ? err.message : "Something went wrong.";
    if (!(err instanceof InboundError)) console.error("widget chat failed", err);
    return NextResponse.json({ error: message }, { status, headers: CORS_HEADERS });
  }
}
