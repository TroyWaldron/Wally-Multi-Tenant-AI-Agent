import { NextResponse, type NextRequest } from "next/server";
import { CORS_HEADERS, rateLimited } from "@/lib/cors";
import { systemStore } from "@/lib/session";
import { MAX_AUDIO_BYTES, transcribe } from "@/lib/transcribe";
import { visitorOf } from "@/lib/widgetVisitor";

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

// A visitor's voice note in, the words out. The widget then sends the words
// like a typed message, so the guest sees what was heard before the reply.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const key = String(form?.get("key") ?? "");
  const audio = form?.get("audio");
  if (!key || !(audio instanceof Blob)) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: CORS_HEADERS });
  if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "That voice note is too long. Please keep it under two minutes." }, { status: 413, headers: CORS_HEADERS });
  const store = systemStore();
  const tenant = await store.getTenantByPublicKey(key);
  if (!tenant) return NextResponse.json({ error: "Unknown widget key." }, { status: 404, headers: CORS_HEADERS });
  if (rateLimited(`voice:${key}:${await visitorOf(req, tenant.id)}`, 10)) {
    return NextResponse.json({ error: "Too many voice notes, please wait a minute." }, { status: 429, headers: CORS_HEADERS });
  }
  const agent = (await store.listAgents(tenant.id)).find((a) => a.status === "live" && a.channels.includes("web"));
  try {
    const text = await transcribe(store, tenant.id, audio, agent?.id ?? null);
    if (!text) return NextResponse.json({ error: "I didn't catch anything. Please try again." }, { status: 422, headers: CORS_HEADERS });
    return NextResponse.json({ text: text.slice(0, 2000) }, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: 502, headers: CORS_HEADERS });
  }
}
