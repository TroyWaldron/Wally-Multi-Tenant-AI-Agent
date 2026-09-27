import { type NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secrets";
import { systemStore } from "@/lib/session";
import { chaseDueTasks } from "@/lib/staffDesk";

/**
 * Sends reminders for due follow-ups across every business. Called by Vercel
 * Cron (Authorization: Bearer CRON_SECRET) or any scheduler holding that secret.
 * The back office also triggers this for its own business when it lists follow-ups.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || !safeEqual(given, secret)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const store = systemStore();
  let chased = 0;
  for (const t of await store.listTenants()) {
    if (t.status === "paused" || t.status === "offboarded") continue;
    chased += (await chaseDueTasks(store, t, { force: true })).chased;
  }
  return NextResponse.json({ ok: true, chased });
}
