import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleInbound, InboundError } from "@/lib/agent/inbound";
import { worksWithTeam } from "@/lib/agent/policy";
import { partnerContext } from "@/lib/partnerAuth";
import { chaseDueTasks } from "@/lib/staffDesk";

const Body = z.object({
  /** The AI staff member to talk to; defaults to the first live back-office one. */
  agentId: z.string().uuid().optional(),
  from: z.object({ name: z.string().min(1).max(80), role: z.string().max(40).optional(), email: z.string().email().optional() }),
  text: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\.|\.$)/g, "") || "staff";

/**
 * A person at the business talks to one of its AI staff from the back office
 * (for example a cleaner answering Coco's reminder, or a manager asking
 * Ledger for a figure). Each person keeps one running chat per AI staff member.
 */
export async function POST(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { store, tenant } = ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { from: { name, role? }, text, agentId? }." }, { status: 400 });
  const { from, text, conversationId } = parsed.data;

  const agents = (await store.listAgents(tenant.id)).filter((a) => a.status === "live");
  const agent = parsed.data.agentId ? agents.find((a) => a.id === parsed.data.agentId) : agents.find(worksWithTeam);
  if (!agent) return NextResponse.json({ error: "No live AI staff member to talk to." }, { status: 404 });

  try {
    const r = await handleInbound({
      store,
      tenant,
      channel: "ops",
      agentId: agent.id,
      conversationId,
      contact: { name: from.name, email: from.email ?? `${slug(from.name)}.${agent.id.slice(0, 8)}@staff.wally` },
      text: `[${from.name}${from.role ? `, ${from.role}` : ""}, from the team] ${text}`,
    });
    after(() => chaseDueTasks(store, tenant));
    return NextResponse.json({ agent: { id: agent.id, name: agent.name }, conversationId: r.conversationId, reply: r.reply });
  } catch (err) {
    if (err instanceof InboundError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
