import { type NextRequest, NextResponse } from "next/server";
import { partnerContext } from "@/lib/partnerAuth";

// The business decides what its leased AI staff may do, in its own back
// office. This lists what the AI staff are waiting on; the decision comes back
// through approvals/[id]. Costs and internal ids never leave Wally.
const HIDDEN = /cost|price_?usd|token|secret|password|connectorId/i;

function clean(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== "object") return typeof v === "string" ? v.slice(0, 2000) : v;
  if (depth > 2) return undefined;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !HIDDEN.test(k)).map(([k, x]) => [k, clean(x, depth + 1)]));
}

export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { store, tenant } = ctx;
  const [approvals, agents] = await Promise.all([store.listApprovals(tenant.id), store.listAgents(tenant.id)]);
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "AI staff";
  return NextResponse.json({
    // Handovers are answered in the guest chat itself, so only requests to act are listed.
    approvals: approvals
      .filter((a) => a.status === "pending" && a.kind === "action")
      .map((a) => ({
        id: a.id,
        agent: name(a.agentId),
        action: a.action,
        summary: a.summary,
        details: clean(a.payload),
        conversationId: a.conversationId,
        createdAt: a.createdAt,
      })),
  });
}
