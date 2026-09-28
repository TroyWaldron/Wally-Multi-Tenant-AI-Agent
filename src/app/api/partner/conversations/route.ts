import { type NextRequest, NextResponse } from "next/server";
import { HELPDESK_CHANNEL } from "@/lib/helpdesk";
import { partnerContext } from "@/lib/partnerAuth";

// The business's recent conversations, newest first, for its back office.
export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const [conversations, agents] = await Promise.all([ctx.store.listConversations(ctx.tenant.id, 100), ctx.store.listAgents(ctx.tenant.id)]);
  const agentOf = (id: string | null) => {
    const a = id ? agents.find((x) => x.id === id) : undefined;
    return a ? { id: a.id, name: a.name, title: a.title } : null;
  };
  return NextResponse.json({
    conversations: conversations.filter((c) => c.channel !== HELPDESK_CHANNEL).map((c) => ({
      id: c.id,
      channel: c.channel,
      status: c.status,
      contact: c.contact,
      agent: agentOf(c.agentId),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}
