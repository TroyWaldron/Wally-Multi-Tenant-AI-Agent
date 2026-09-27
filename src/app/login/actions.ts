"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkDemoPassword, DEMO_COOKIE, demoCookieValue } from "@/lib/session";
import { isSupabaseConfigured, userClient } from "@/lib/supabase";

export type LoginState = { error?: string; sent?: boolean };

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const intent = String(form.get("intent") ?? "password");

  if (!isSupabaseConfigured()) {
    if (!checkDemoPassword(password)) return { error: "That password doesn't match ADMIN_PASSWORD." };
    (await cookies()).set(DEMO_COOKIE, demoCookieValue(), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 7 });
    redirect("/console");
  }

  const db = await userClient();
  if (intent === "link") {
    if (!email) return { error: "Enter your email address first." };
    const allowed = (process.env.PLATFORM_ADMIN_EMAILS ?? "").toLowerCase().split(",").map((e) => e.trim());
    const origin = (await headers()).get("origin") ?? "";
    const { error } = await db.auth.signInWithOtp({
      email,
      // Only platform admins can create an account this way; everyone else is invited.
      options: { shouldCreateUser: allowed.includes(email.toLowerCase()), emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) return { error: "We couldn't send a link to that address. Ask your admin for an invite." };
    return { sent: true };
  }

  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return { error: "Email or password is incorrect." };
  redirect("/console");
}

export async function logout() {
  if (isSupabaseConfigured()) await (await userClient()).auth.signOut();
  (await cookies()).delete(DEMO_COOKIE);
  redirect("/login");
}
