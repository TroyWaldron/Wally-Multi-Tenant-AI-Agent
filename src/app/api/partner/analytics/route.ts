import { type NextRequest, NextResponse } from "next/server";
import { isBillable } from "@/lib/billing";
import { partnerContext } from "@/lib/partnerAuth";

const DAYS = 30;
// Office hours for the "answered while you were closed" figure, in the
// business's own time zone.
const OPEN_HOUR = 8;
const CLOSE_HOUR = 17;

/**
 * How the AI staff did over the last 30 days, for the business's own
 * analytics page: chats per day and hour, how many the AI handled alone,
 * how many it passed to the team, after-hours coverage and outcomes.
 */
export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { store, tenant } = ctx;
  const now = Date.now();
  const since = new Date(now - DAYS * 86_400_000).toISOString();
  const before = new Date(now - 2 * DAYS * 86_400_000).toISOString();

  const [all, approvals, outcomes] = await Promise.all([
    store.listConversationsSince(tenant.id, before),
    store.listApprovals(tenant.id),
    store.listOutcomes(tenant.id, 1000),
  ]);
  const chats = all.filter(isBillable);
  const current = chats.filter((c) => c.createdAt >= since);
  const previous = chats.length - current.length;

  const local = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const parts = (iso: string) => {
    const p = Object.fromEntries(local.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
  };

  const byDay: Record<string, number> = {};
  for (let i = DAYS - 1; i >= 0; i--) byDay[parts(new Date(now - i * 86_400_000).toISOString()).day] = 0;
  const byHour = Array.from({ length: 24 }, () => 0);
  const byChannel: Record<string, number> = {};
  let afterHours = 0;
  for (const c of current) {
    const { day, hour } = parts(c.createdAt);
    if (day in byDay) byDay[day]++;
    byHour[hour]++;
    byChannel[c.channel] = (byChannel[c.channel] ?? 0) + 1;
    if (hour < OPEN_HOUR || hour >= CLOSE_HOUR) afterHours++;
  }

  const ids = new Set(current.map((c) => c.id));
  // Handed to a person: Sunny escalated it, or the team took it over.
  const handedOver = new Set([
    ...approvals.filter((a) => a.kind === "escalation" && a.conversationId && ids.has(a.conversationId)).map((a) => a.conversationId),
    ...current.filter((c) => c.status === "waiting_human").map((c) => c.id),
  ]).size;
  const outcomeCounts: Record<string, number> = {};
  for (const o of outcomes) if (o.createdAt >= since) outcomeCounts[o.kind] = (outcomeCounts[o.kind] ?? 0) + 1;

  return NextResponse.json({
    days: DAYS,
    timezone: tenant.timezone,
    officeHours: { open: OPEN_HOUR, close: CLOSE_HOUR },
    chats: current.length,
    previousChats: previous,
    handedOver,
    handledAlone: current.length - handedOver,
    afterHours,
    byDay: Object.entries(byDay).map(([day, count]) => ({ day, count })),
    byHour,
    byChannel: Object.entries(byChannel).map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count),
    outcomes: Object.entries(outcomeCounts).map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
  });
}
