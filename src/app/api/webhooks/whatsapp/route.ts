// Global WhatsApp router: one Meta app, many client numbers. Each business's
// number is registered as a "whatsapp" channel with its phone_number_id, so
// a single webhook URL serves every tenant (the gap Chatwoot has today).
// Wally answers, then emits agent_replied to that business's n8n, which
// sends the reply through the WhatsApp Cloud API.
import { after, NextResponse, type NextRequest } from "next/server";
import { handleInbound } from "@/lib/agent/inbound";
import { verifyMetaSignature, safeEqual } from "@/lib/secrets";
import { systemStore } from "@/lib/session";
import { getConfig } from "@/lib/settings";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = await getConfig(null, "WHATSAPP_VERIFY_TOKEN");
  if (p.get("hub.mode") === "subscribe" && token && safeEqual(p.get("hub.verify_token") ?? "", token)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

type WaChange = {
  value?: {
    metadata?: { phone_number_id?: string };
    contacts?: { profile?: { name?: string }; wa_id?: string }[];
    messages?: { from: string; type: string; text?: { body?: string } }[];
  };
};

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const appSecret = await getConfig(null, "WHATSAPP_APP_SECRET");
  if (!appSecret || !verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let payload: { entry?: { changes?: WaChange[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  const store = systemStore();
  const jobs: (() => Promise<void>)[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      const phoneNumberId = v?.metadata?.phone_number_id;
      if (!phoneNumberId || !v?.messages?.length) continue;
      for (const m of v.messages) {
        // Voice notes, images and other types arrive in phase 2; text for now.
        const text = m.type === "text" ? m.text?.body : undefined;
        if (!text) continue;
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        jobs.push(async () => {
          const channel = await store.findChannel("whatsapp", phoneNumberId);
          if (!channel) return console.warn(`WhatsApp number ${phoneNumberId} is not registered to any business.`);
          const tenant = await store.getTenant(channel.tenantId);
          if (!tenant) return;
          await handleInbound({ store, tenant, channel: "whatsapp", text, agentId: channel.agentId, contact: { phone: m.from, name } });
        });
      }
    }
  }
  // Meta expects a fast 200; the agent runs after the response.
  after(async () => {
    for (const job of jobs) await job().catch((e) => console.error("WhatsApp job failed", e));
  });
  return NextResponse.json({ ok: true });
}
