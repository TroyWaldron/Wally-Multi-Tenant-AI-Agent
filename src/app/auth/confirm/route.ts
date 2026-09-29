import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { userClient } from "@/lib/supabase";

// Where one-time sign-in links from People land. Verifying the token sets the
// session cookie; a used or expired link goes back to the sign-in page.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const tokenHash = p.get("token_hash");
  const type = p.get("type") as EmailOtpType | null;
  const nextParam = p.get("next") ?? "/console";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/console";
  if (tokenHash && type) {
    const { error } = await (await userClient()).auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, req.url));
  }
  return NextResponse.redirect(new URL("/login?expired=1", req.url));
}
