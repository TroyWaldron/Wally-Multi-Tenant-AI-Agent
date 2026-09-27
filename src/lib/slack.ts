// Slack presence for a business's AI staff. One Slack app per business
// (its own workspace), set up under Settings > Slack:
//  - A guest needs a person: Wally posts in the alert channel. A reply in
//    that thread goes to the guest, like a reply from the console.
//  - Staff can DM the app or @mention it to talk to the AI team ("Coco,
//    what's due this week?"). Those chats are internal and never billed.
import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/secrets";
import { getConfig } from "@/lib/settings";
import { systemStore } from "@/lib/session";
import type { Tenant } from "@/lib/types";

export const SLACK_THREAD = "slack.thread";

export async function slackConfig(tenantId: string) {
  const [token, signingSecret, alertChannel] = await Promise.all([
    getConfig(tenantId, "SLACK_BOT_TOKEN"),
    getConfig(tenantId, "SLACK_SIGNING_SECRET"),
    getConfig(tenantId, "SLACK_ALERT_CHANNEL"),
  ]);
  return { token, signingSecret, alertChannel };
}

/** Slack's v0 request signature, with a 5 minute replay window. */
export function verifySlack(raw: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()) {
  if (!timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex");
  return safeEqual(signature, expected);
}

export async function slackApi(token: string, method: string, body: Record<string, unknown>) {
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; ts?: string; user?: { real_name?: string; name?: string } };
    if (!d.ok) console.error(`slack ${method} failed:`, d.error ?? res.status);
    return d;
  } catch (err) {
    console.error(`slack ${method} failed:`, err);
    return { ok: false as const };
  }
}

/** The Slack thread already opened for a guest's chat, if any. */
export async function threadForConversation(tenantId: string, conversationId: string) {
  const log = await systemStore().listAudit(tenantId, 500);
  const hit = log.find((a) => a.action === SLACK_THREAD && a.detail.conversationId === conversationId);
  return hit ? { ts: String(hit.detail.ts), channel: String(hit.detail.channel) } : null;
}

export async function conversationForThread(tenantId: string, channel: string, ts: string) {
  const log = await systemStore().listAudit(tenantId, 500);
  const hit = log.find((a) => a.action === SLACK_THREAD && a.detail.ts === ts && a.detail.channel === channel);
  return hit ? String(hit.detail.conversationId) : null;
}

/**
 * A guest is waiting for a person. The first alert opens a thread in the
 * alert channel; later guest messages land in the same thread.
 */
export async function alertSlack(tenant: Pick<Tenant, "id">, kind: "needs_person" | "guest_message", a: { conversationId: string; channel?: string; who?: string; text?: string }) {
  const { token, alertChannel } = await slackConfig(tenant.id);
  if (!token || !alertChannel) return;
  const existing = await threadForConversation(tenant.id, a.conversationId);
  if (existing) {
    await slackApi(token, "chat.postMessage", { channel: existing.channel, thread_ts: existing.ts, text: `*Guest:* ${a.text ?? "(new message)"}` });
    return;
  }
  const head =
    kind === "needs_person"
      ? `:bell: *A guest needs a person*${a.who ? ` (${a.who})` : ""} on ${a.channel ?? "chat"}.`
      : `:speech_balloon: *New message from a guest*${a.who ? ` (${a.who})` : ""} on ${a.channel ?? "chat"}.`;
  const posted = await slackApi(token, "chat.postMessage", {
    channel: alertChannel,
    text: `${head}\n>${(a.text ?? "").slice(0, 300)}\nReply in this thread to answer them.`,
  });
  if (posted.ok && posted.ts) {
    await systemStore().audit(tenant.id, { actorType: "system", actor: "slack", action: SLACK_THREAD, detail: { conversationId: a.conversationId, ts: posted.ts, channel: alertChannel } });
  }
}
