import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { HELPDESK_CHANNEL, HELPDESK_TOPICS, helpdeskFromBusiness } from "@/lib/helpdesk";
import { notify } from "@/lib/n8n";
import { partnerContext } from "@/lib/partnerAuth";

// The business's helpdesk tickets with the Wally team, newest first.
export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const tickets = (await ctx.store.listConversations(ctx.tenant.id, 300)).filter((c) => c.channel === HELPDESK_CHANNEL);
  const withFirst = await Promise.all(
    tickets.slice(0, 50).map(async (t) => {
      const msgs = await ctx.store.listMessages(ctx.tenant.id, t.id);
      const first = msgs.find((m) => m.role === "user");
      return {
        id: t.id,
        status: t.status,
        openedBy: t.contact.name ?? "",
        topic: (first?.meta.topic as string | undefined) ?? "question",
        subject: first?.content.slice(0, 120) ?? "",
        messages: msgs.length,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    })
  );
  return NextResponse.json({ tickets: withFirst });
}

const Body = z.object({ text: z.string().trim().min(1).max(4000), by: z.string().trim().min(1).max(120), topic: z.enum(HELPDESK_TOPICS) });

// Opens a new ticket.
export async function POST(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  const ticket = await helpdeskFromBusiness(ctx.store, ctx.tenant.id, parsed.data);
  await ctx.store.audit(ctx.tenant.id, { actorType: "user", actor: parsed.data.by, action: "helpdesk.opened", detail: { ticketId: ticket.id, topic: parsed.data.topic } });
  notify(ctx.tenant, "message_received", { conversationId: ticket.id, channel: HELPDESK_CHANNEL, contact: ticket.contact, text: parsed.data.text, helpdesk: true });
  return NextResponse.json({ ok: true, id: ticket.id });
}
