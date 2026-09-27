import { type NextRequest, NextResponse } from "next/server";
import { partnerContext } from "@/lib/partnerAuth";

// The business's recent conversations, newest first, for its back office.
export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const conversations = await ctx.store.listConversations(ctx.tenant.id, 100);
  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      channel: c.channel,
      status: c.status,
      contact: c.contact,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}
