import { type NextRequest, NextResponse } from "next/server";
import { partnerContext } from "@/lib/partnerAuth";
import { computeRoi } from "@/lib/roi";

// Return on investment for the business's own back office: hours and staff
// cost saved and value earned by its AI staff, against the agreed price.
export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  return NextResponse.json(await computeRoi(ctx.store, ctx.tenant));
}
