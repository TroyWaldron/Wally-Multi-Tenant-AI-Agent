import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { partnerContext } from "@/lib/partnerAuth";
import { CHECK_IN } from "@/lib/team";

const Body = z.object({ agent: z.string().trim().min(1).max(80), summary: z.string().trim().max(500).optional() });

// A back-office AI staff member (like Coco the coordinator) that runs inside
// the business's own systems reports its daily round here, so Wally can tell
// whether it is up or has missed a round.
export async function POST(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say which agent is checking in." }, { status: 400 });
  const { agent, summary } = parsed.data;
  const agents = await ctx.store.listAgents(ctx.tenant.id);
  const match = agents.find((a) => a.id === agent || a.name.toLowerCase() === agent.toLowerCase());
  if (!match) return NextResponse.json({ error: "No such agent." }, { status: 404 });
  await ctx.store.audit(ctx.tenant.id, { actorType: "agent", actor: match.id, action: CHECK_IN, detail: { name: match.name, summary: summary ?? null } });
  return NextResponse.json({ ok: true });
}
