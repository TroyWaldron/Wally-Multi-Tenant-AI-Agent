import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { decide } from "@/lib/approvals";
import { partnerContext } from "@/lib/partnerAuth";

const Body = z.object({
  decision: z.enum(["approve", "decline"]),
  /** The staff member who decided, as the back office names them. */
  by: z.string().min(1).max(120),
  /** Why it was declined; becomes a rule the AI staff member follows. */
  reason: z.string().max(200).optional(),
  /** A reworded draft or email. */
  edits: z.object({ subject: z.string().max(300).optional(), body: z.string().max(10000).optional() }).optional(),
});

/** A person at the business approves or declines what an AI staff member asked for. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { decision: approve|decline, by, reason?, edits? }." }, { status: 400 });
  const { decision, by, reason, edits } = parsed.data;
  const r = await decide(ctx.store, ctx.tenant, id, decision === "approve" ? "approved" : "rejected", `${by} (${ctx.tenant.name})`, reason, edits);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json(r);
}
