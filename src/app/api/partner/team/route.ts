import { type NextRequest, NextResponse } from "next/server";
import { partnerContext } from "@/lib/partnerAuth";
import { loadTeam } from "@/lib/teamData";

// The business's AI team for its own back office: org chart and whether
// each AI staff member is working right now.
export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  return NextResponse.json({ team: await loadTeam(ctx.store, ctx.tenant.id) });
}
