import type { NextRequest } from "next/server";
import { safeEqual } from "@/lib/secrets";
import { getConfig } from "@/lib/settings";

// Who to rate-limit. Normally the caller's IP; but when a business's own
// website relays its guests' chats from its server, every call shares that
// server's IP. A relay that proves itself with the business's
// WIDGET_RELAY_SECRET may name the guest instead (X-Wally-Visitor), so each
// guest keeps their own limit. Without the secret the header is ignored.
export async function visitorOf(req: NextRequest, tenantId: string) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const relaySecret = req.headers.get("x-wally-relay-secret");
  const visitor = req.headers.get("x-wally-visitor")?.trim().slice(0, 100);
  if (!relaySecret || !visitor) return ip;
  const expected = await getConfig(tenantId, "WIDGET_RELAY_SECRET");
  return expected && safeEqual(relaySecret, expected) ? `relay:${visitor}` : ip;
}
