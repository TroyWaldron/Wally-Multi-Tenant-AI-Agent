import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reactToEvent, receiveEvent } from "@/lib/events";
import { partnerContext } from "@/lib/partnerAuth";

const Body = z.object({ event: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/), data: z.record(z.string(), z.unknown()).default({}) });

/**
 * A business's own system tells Wally something happened (a booking came in,
 * a payment was recorded). Wally logs it and the AI staff who react to that
 * event get to work in the background.
 */
export async function POST(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { store, tenant } = ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { event, data }." }, { status: 400 });
  const { event, data } = parsed.data;
  const { outcome, agents } = await receiveEvent(store, tenant, event, data, "partner");
  if (agents.length) after(() => reactToEvent(store, tenant, event, data, agents.map((a) => a.id)));
  return NextResponse.json({ ok: true, recordedOutcome: outcome, reactingAgents: agents.map((a) => a.name) });
}
