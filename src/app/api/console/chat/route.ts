// Playground chat for signed-in users. Runs through the same pipeline as
// every other channel, on the "playground" channel, and can reach draft agents.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleInbound, InboundError } from "@/lib/agent/inbound";
import { getSession } from "@/lib/session";

const Body = z.object({ tenantId: z.string(), agentId: z.string(), text: z.string().max(4000), conversationId: z.string().nullish() });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  // RLS-scoped lookup: a user can only reach a tenant they belong to.
  const tenant = await session.store.getTenant(parsed.data.tenantId);
  if (!tenant) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  try {
    const r = await handleInbound({
      store: session.store,
      tenant,
      channel: "playground",
      text: parsed.data.text,
      agentId: parsed.data.agentId,
      conversationId: parsed.data.conversationId,
      contact: { name: `Test (${session.user.email})` },
      allowDraft: true,
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof InboundError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("playground chat failed", err);
    return NextResponse.json({ error: "The agent hit an error. Check the Audit log for details." }, { status: 500 });
  }
}
