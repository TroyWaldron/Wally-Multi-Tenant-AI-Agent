import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { helpdeskFromBusiness, isHelpdesk } from "@/lib/helpdesk";
import { notify } from "@/lib/n8n";
import { partnerContext } from "@/lib/partnerAuth";

type Params = { params: Promise<{ id: string }> };

// One ticket's thread: the business's messages and the Wally team's answers.
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const ticket = await ctx.store.getConversation(ctx.tenant.id, (await params).id);
  if (!isHelpdesk(ticket)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const messages = (await ctx.store.listMessages(ctx.tenant.id, ticket.id))
    .filter((m) => m.role === "user" || m.role === "staff")
    .map((m) => ({ id: m.id, from: m.role === "user" ? "business" : "wally", by: String(m.meta.by ?? ""), content: m.content, createdAt: m.createdAt }));
  return NextResponse.json({ ticket: { id: ticket.id, status: ticket.status }, messages });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), text: z.string().trim().min(1).max(4000), by: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("close"), by: z.string().trim().min(1).max(120) }),
]);

// The business adds to the ticket, or closes it.
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  const ticket = await ctx.store.getConversation(ctx.tenant.id, (await params).id);
  if (!isHelpdesk(ticket)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const b = parsed.data;
  if (b.action === "close") {
    await ctx.store.setConversationStatus(ctx.tenant.id, ticket.id, "closed");
  } else {
    await helpdeskFromBusiness(ctx.store, ctx.tenant.id, { ticket, text: b.text, by: b.by });
    notify(ctx.tenant, "message_received", { conversationId: ticket.id, channel: ticket.channel, contact: ticket.contact, text: b.text, helpdesk: true });
  }
  return NextResponse.json({ ok: true });
}
