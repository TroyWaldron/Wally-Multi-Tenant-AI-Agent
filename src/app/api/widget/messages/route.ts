import { NextResponse, type NextRequest } from "next/server";
import { CORS_HEADERS, rateLimited } from "@/lib/cors";
import { systemStore } from "@/lib/session";
import { visitorOf } from "@/lib/widgetVisitor";

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

// The widget checks here for replies the team typed in the console, so a
// guest sees them without sending another message. The conversation id is
// the guest's own unguessable id; only team replies come back, never who
// sent them or the AI's tool details.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const key = q.get("key") ?? "";
  const conversationId = q.get("conversationId") ?? "";
  const after = Number(q.get("after") ?? 0) || 0;
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: CORS_HEADERS });

  const store = systemStore();
  const tenant = key ? await store.getTenantByPublicKey(key) : null;
  if (!tenant) return NextResponse.json({ error: "Unknown widget key." }, { status: 404, headers: CORS_HEADERS });
  // Checks are cheap but frequent, so they get their own, looser limit.
  if (rateLimited(`poll:${key}:${await visitorOf(req, tenant.id)}`, 40)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: CORS_HEADERS });
  }

  const conv = await store.getConversation(tenant.id, conversationId);
  if (!conv || conv.channel !== "web") return NextResponse.json({ error: "Unknown conversation." }, { status: 404, headers: CORS_HEADERS });
  const messages = (await store.listMessages(tenant.id, conv.id))
    .filter((m) => m.role === "staff" && m.id > after)
    .map((m) => ({ id: m.id, text: m.content }));
  return NextResponse.json({ waiting: conv.status === "waiting_human", messages }, { headers: CORS_HEADERS });
}
