import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { partnerContext } from "@/lib/partnerAuth";
import type { AuditEntry } from "@/lib/types";

// The business's back office and Wally share one activity trail. GET gives the
// back office what the AI staff did here; POST records what happened there
// (staff actions, AI tool use, anything flagged) so Wally sees rogue activity
// across both. Costs never leave Wally.
const HIDDEN = /cost|price_?usd|token|secret|password/i;

function clean(detail: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(detail).filter(([k]) => !HIDDEN.test(k)));
}

/** What the AI staff and Wally did for this business, newest first. */
export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { store, tenant } = ctx;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 200, 500);
  const log = await store.listAudit(tenant.id, limit);
  const entries = log
    // Entries the back office sent here already show there.
    .filter((e: AuditEntry) => !e.action.startsWith("hub.") && e.action !== "slack.thread" && !e.action.startsWith("usage."))
    .map((e: AuditEntry) => ({ id: e.id, at: e.createdAt, actorType: e.actorType, actor: e.actor, action: e.action, detail: clean(e.detail) }));
  return NextResponse.json({ entries });
}

const Entry = z.object({
  at: z.string().max(40),
  actorType: z.enum(["staff", "ai", "system", "guest"]),
  actor: z.string().max(120),
  action: z.string().max(80),
  summary: z.string().max(500),
  flagged: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  ip: z.string().max(60).optional(),
});
const Body = z.object({ entries: z.array(Entry).min(1).max(50) });

const ACTOR_TYPE = { staff: "user", ai: "agent", system: "system", guest: "widget" } as const;

/** The back office reports its own activity. Flagged entries are kept as hub.flagged so they stand out. */
export async function POST(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { store, tenant } = ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { entries: [{ at, actorType, actor, action, summary, flagged?, reason?, ip? }] }." }, { status: 400 });
  for (const e of parsed.data.entries) {
    await store.audit(tenant.id, {
      actorType: ACTOR_TYPE[e.actorType],
      actor: e.actor,
      action: e.flagged ? "hub.flagged" : `hub.${e.action}`.slice(0, 90),
      detail: { source: "back office", at: e.at, what: e.action, summary: e.summary, ...(e.reason ? { reason: e.reason } : {}), ...(e.ip ? { ip: e.ip } : {}) },
    });
  }
  return NextResponse.json({ ok: true, saved: parsed.data.entries.length });
}
