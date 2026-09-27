import { type NextRequest, NextResponse } from "next/server";
import { contractActiveOn, isBillable, monthCharge } from "@/lib/billing";
import { partnerContext } from "@/lib/partnerAuth";
import type { Contract } from "@/lib/types";

function plan(c: Contract | undefined, conversations: number) {
  if (!c) return null;
  return {
    name: c.planName,
    currency: c.currency,
    monthlyFee: c.monthlyFee,
    includedConversations: c.includedConversations,
    overageRate: c.overageRate,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    charge: monthCharge(c, conversations),
  };
}

// The business's AI staff, what each has done this month and what it costs
// the business under its agreement with Wally. Wally's own model costs are
// never included: the business sees the price it agreed to, not ours.
export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { store, tenant } = ctx;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const [agents, conversations, approvals, contracts] = await Promise.all([
    store.listAgents(tenant.id),
    store.listConversationsSince(tenant.id, monthStart),
    store.listApprovals(tenant.id),
    store.listContracts(tenant.id),
  ]);
  const billable = conversations.filter(isBillable);
  const active = contracts.filter((c) => contractActiveOn(c, today));

  const staff = agents
    .filter((a) => a.status !== "draft")
    .map((a) => {
      const count = billable.filter((c) => c.agentId === a.id).length;
      return {
        id: a.id,
        name: a.name,
        title: a.title,
        status: a.status,
        channels: a.channels,
        month: {
          conversations: count,
          handedOver: approvals.filter((p) => p.agentId === a.id && p.kind === "escalation" && p.createdAt >= monthStart).length,
        },
        plan: plan(active.find((c) => c.agentId === a.id), count),
      };
    });
  const businessWide = active.filter((c) => !c.agentId).map((c) => plan(c, billable.length));
  return NextResponse.json({ monthStart, staff, businessWide });
}
