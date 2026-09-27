// Who is signed in, and which store they get.
//
// Supabase mode: Supabase Auth; data reads go through the user's JWT so RLS
// decides what they see. Emails listed in PLATFORM_ADMIN_EMAILS are made
// platform admins on first sign-in.
// Demo mode (no Supabase env yet): in-memory store, guarded by ADMIN_PASSWORD
// when it is set.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { memoryStore } from "@/lib/store/memory";
import { supabaseStore } from "@/lib/store/supabase";
import type { Store } from "@/lib/store/types";
import { isSupabaseConfigured, serviceClient, userClient } from "@/lib/supabase";

export type Session = {
  mode: "demo" | "supabase";
  user: { id: string; email: string };
  isPlatformAdmin: boolean;
  /** Agencies this person administers (white-label resellers such as Novate). */
  agencyIds: string[];
  /** RLS-scoped store for console reads and writes. */
  store: Store;
};

export const DEMO_COOKIE = "wally_demo";

function demoToken(password: string) {
  return createHmac("sha256", password).update("wally-demo-session").digest("hex");
}

export function checkDemoPassword(input: string) {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function demoCookieValue() {
  return demoToken(process.env.ADMIN_PASSWORD ?? "");
}

/** Store for server-side entry points without a user (webhooks, widget). */
export function systemStore(): Store {
  return isSupabaseConfigured() ? supabaseStore(serviceClient()) : memoryStore;
}

export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) {
    const password = process.env.ADMIN_PASSWORD;
    // A hosted deploy without Supabase or a password stays locked rather than
    // serving an open console to the internet.
    if (!password && process.env.VERCEL) return null;
    if (password) {
      const jar = await cookies();
      if (jar.get(DEMO_COOKIE)?.value !== demoToken(password)) return null;
    }
    return { mode: "demo", user: { id: "demo", email: "demo@wally.local" }, isPlatformAdmin: true, agencyIds: [], store: memoryStore };
  }

  const db = await userClient();
  const { data } = await db.auth.getUser();
  if (!data.user) return null;
  const email = data.user.email ?? "";

  let { data: memberships } = await db.from("memberships").select("role, agency_id").eq("user_id", data.user.id);
  const admins = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!memberships?.some((m) => m.role === "platform_admin") && admins.includes(email.toLowerCase())) {
    await serviceClient().from("memberships").insert({ user_id: data.user.id, role: "platform_admin" });
    memberships = [...(memberships ?? []), { role: "platform_admin", agency_id: null }];
  }

  // Agency admin invites wait for the person's first sign-in.
  if (email) {
    const svc = serviceClient();
    const { data: invites } = await svc.from("agency_invites").select("id, agency_id").eq("email", email.toLowerCase());
    for (const inv of invites ?? []) {
      if (!memberships?.some((m) => m.role === "agency_admin" && m.agency_id === inv.agency_id)) {
        await svc.from("memberships").insert({ user_id: data.user.id, agency_id: inv.agency_id, role: "agency_admin" });
        memberships = [...(memberships ?? []), { role: "agency_admin", agency_id: inv.agency_id }];
      }
      await svc.from("agency_invites").delete().eq("id", inv.id);
    }
  }

  return {
    mode: "supabase",
    user: { id: data.user.id, email },
    isPlatformAdmin: Boolean(memberships?.some((m) => m.role === "platform_admin")),
    agencyIds: (memberships ?? []).filter((m) => m.role === "agency_admin" && m.agency_id).map((m) => m.agency_id as string),
    store: supabaseStore(db),
  };
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
