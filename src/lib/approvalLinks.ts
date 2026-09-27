// One-tap review links for approvals, so a manager can decide from an email,
// a phone alert or a WhatsApp message without signing in. The link opens a
// page that shows the request; nothing is decided until a button on that
// page is pressed (mail scanners open links, they don't press buttons).
// Links are signed and expire after three days.
import { createHash, createHmac } from "node:crypto";
import { safeEqual } from "@/lib/secrets";

const TTL_MS = 3 * 86_400_000;

function key() {
  const base = process.env.APPROVAL_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_PASSWORD;
  if (!base) return null;
  return createHash("sha256").update(`wally-approval-links:${base}`).digest();
}

const sign = (k: Buffer, body: string) => createHmac("sha256", k).update(body).digest("base64url").slice(0, 32);

export function publicUrl() {
  const u = process.env.WALLY_PUBLIC_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return u.replace(/\/$/, "") || null;
}

/** The review link for one approval, or null when Wally can't sign links here. */
export function approvalLink(tenantId: string, approvalId: string, now = Date.now()) {
  const k = key();
  const base = publicUrl();
  if (!k || !base) return null;
  const body = `${tenantId}.${approvalId}.${(now + TTL_MS).toString(36)}`;
  return `${base}/a/${Buffer.from(body).toString("base64url")}.${sign(k, body)}`;
}

export function readApprovalToken(token: string, now = Date.now()) {
  const k = key();
  const [b64, sig] = token.split(".");
  if (!k || !b64 || !sig) return null;
  const body = Buffer.from(b64, "base64url").toString();
  if (!safeEqual(sig, sign(k, body))) return null;
  const [tenantId, approvalId, exp] = body.split(".");
  if (!tenantId || !approvalId || !exp || parseInt(exp, 36) < now) return null;
  return { tenantId, approvalId };
}
