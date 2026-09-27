import { type NextRequest, NextResponse } from "next/server";
import { partnerContext } from "@/lib/partnerAuth";

// The business's AI staff and what each has done and cost this month, so
// its own back office can show them alongside its human team.
export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { store, tenant } = ctx;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const [agents, usage, conversations, approvals] = await Promise.all([
    store.listAgents(tenant.id),
    store.listUsage(tenant.id, monthStart),
    store.listConversations(tenant.id, 1000),
    store.listApprovals(tenant.id),
  ]);

  const staff = agents
    .filter((a) => a.status !== "draft")
    .map((a) => {
      const convs = conversations.filter((c) => c.agentId === a.id && c.createdAt >= monthStart);
      return {
        id: a.id,
        name: a.name,
        title: a.title,
        status: a.status,
        channels: a.channels,
        monthlyBudgetUsd: a.monthlyBudgetUsd,
        month: {
          costUsd: Math.round(usage.filter((u) => u.agentId === a.id).reduce((sum, u) => sum + u.costUsd, 0) * 100) / 100,
          conversations: convs.length,
          handedOver: approvals.filter((p) => p.agentId === a.id && p.kind === "escalation" && p.createdAt >= monthStart).length,
        },
      };
    });
  return NextResponse.json({ monthStart, currency: "USD", staff });
}
