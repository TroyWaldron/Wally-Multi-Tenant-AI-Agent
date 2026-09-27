// Slack Events API for one business: /api/webhooks/slack?key=<widget key>.
// Verified with that business's own signing secret. Slack wants an answer
// within 3 seconds, so the work runs after the response.
import { after, NextResponse, type NextRequest } from "next/server";
import { handleInbound } from "@/lib/agent/inbound";
import { systemStore } from "@/lib/session";
import { conversationForThread, slackApi, slackConfig, verifySlack } from "@/lib/slack";
import { sendStaffReply } from "@/lib/staffReply";
import type { Tenant } from "@/lib/types";

type SlackEvent = { type: string; subtype?: string; bot_id?: string; user?: string; text?: string; channel: string; channel_type?: string; ts: string; thread_ts?: string };

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const store = systemStore();
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const tenant = key ? await store.getTenantByPublicKey(key) : null;
  if (!tenant) return new NextResponse("Unknown business", { status: 404 });
  const cfg = await slackConfig(tenant.id);
  if (!cfg.signingSecret || !verifySlack(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"), cfg.signingSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let body: { type?: string; challenge?: string; event?: SlackEvent };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }
  if (body.type === "url_verification") return NextResponse.json({ challenge: body.challenge });
  // Slack retries when we're slow; the first delivery is already being handled.
  if (req.headers.get("x-slack-retry-num")) return new NextResponse("ok");
  const event = body.event;
  if (body.type === "event_callback" && event && cfg.token && !event.bot_id && !event.subtype && event.user) {
    const token = cfg.token;
    after(() => handleEvent(tenant, token, event).catch((err) => console.error("slack event failed", err)));
  }
  return new NextResponse("ok");
}

async function handleEvent(tenant: Tenant, token: string, e: SlackEvent) {
  const store = systemStore();
  const text = (e.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!text) return;
  const person = await slackApi(token, "users.info", { user: e.user });
  const name = person.user?.real_name || person.user?.name || "Team";

  // A reply in a guest's alert thread goes to that guest.
  if (e.thread_ts && e.type === "message" && e.channel_type !== "im") {
    const conversationId = await conversationForThread(tenant.id, e.channel, e.thread_ts);
    const conv = conversationId ? await store.getConversation(tenant.id, conversationId) : null;
    if (!conv) return;
    await sendStaffReply(store, tenant, conv, text, `${name} (Slack)`);
    await slackApi(token, "reactions.add", { channel: e.channel, timestamp: e.ts, name: "white_check_mark" });
    return;
  }

  // Otherwise a DM or an @mention: someone on the team talking to the AI staff.
  if (e.type !== "app_mention" && !(e.type === "message" && e.channel_type === "im")) return;
  const live = (await store.listAgents(tenant.id)).filter((a) => a.status === "live");
  const named = live.find((a) => new RegExp(`\\b${a.name.replace(/[^\w]/g, "")}\\b`, "i").test(text));
  const agent = named ?? live.find((a) => a.channels.includes("ops")) ?? live[0];
  if (!agent) return;
  const r = await handleInbound({
    store,
    tenant,
    channel: "slack",
    agentId: agent.id,
    text: `[${name}, a member of the team, via Slack] ${text}`,
    // One running chat per person and agent.
    contact: { name, email: `${e.user}.${agent.id.slice(0, 8)}@slack` },
  });
  if (r.reply) {
    await slackApi(token, "chat.postMessage", { channel: e.channel, thread_ts: e.type === "app_mention" ? e.thread_ts ?? e.ts : undefined, text: `*${agent.name}:* ${r.reply}` });
  }
}
