import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { HELPDESK_CHANNEL } from "@/lib/helpdesk";
import { partnerContext } from "@/lib/partnerAuth";
import { sendStaffReply } from "@/lib/staffReply";

// One conversation's transcript. Tool calls stay in Wally; the back office
// sees what the guest, the agent and the team said.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { id } = await params;
  const conv = await ctx.store.getConversation(ctx.tenant.id, id);
  if (!conv || conv.channel === HELPDESK_CHANNEL) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const messages = (await ctx.store.listMessages(ctx.tenant.id, conv.id))
    .filter((m) => m.role !== "tool")
    .map((m) => ({ id: m.id, role: m.role, content: m.content, by: m.role === "staff" ? String(m.meta.by ?? "") : undefined, createdAt: m.createdAt }));
  return NextResponse.json({ conversation: { id: conv.id, channel: conv.channel, status: conv.status, contact: conv.contact }, messages });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), text: z.string().trim().min(1).max(4000), by: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("status"), status: z.enum(["open", "waiting_human", "closed"]), by: z.string().trim().min(1).max(120) }),
]);

// The team replies, takes over, hands back to the agent, or closes the chat.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { id } = await params;
  const conv = await ctx.store.getConversation(ctx.tenant.id, id);
  if (!conv || conv.channel === HELPDESK_CHANNEL) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const b = parsed.data;
  if (b.action === "reply") {
    await sendStaffReply(ctx.store, ctx.tenant, conv, b.text, b.by);
  } else {
    await ctx.store.setConversationStatus(ctx.tenant.id, conv.id, b.status);
    await ctx.store.audit(ctx.tenant.id, { actorType: "user", actor: b.by, action: `conversation.${b.status}`, detail: { conversationId: conv.id, via: "partner" } });
  }
  return NextResponse.json({ ok: true });
}
