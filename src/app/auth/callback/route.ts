import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) await (await userClient()).auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL("/console", req.url));
}
