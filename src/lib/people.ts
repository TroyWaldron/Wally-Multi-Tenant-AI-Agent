// People who can sign in to Wally, and what each may reach. Only the Wally
// team (platform admins) manages this, so it runs on the service client
// after the caller's session has been checked.
//
// Adding someone never sends an email: Wally makes a one-time sign-in link
// the admin passes on however suits (WhatsApp, email). The person opens it,
// lands on My account and sets a password.
import { serviceClient } from "@/lib/supabase";

import type { AccessRole, Person } from "@/lib/access";

export { ACCESS_ROLES, type AccessRole, type Person } from "@/lib/access";

export async function listPeople(): Promise<Person[]> {
  const svc = serviceClient();
  const { data, error } = await svc.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  const { data: rows } = await svc.from("memberships").select("id, user_id, role, tenant_id, agency_id").order("created_at");
  return data.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      access: (rows ?? [])
        .filter((m) => m.user_id === u.id)
        .map((m) => ({ id: m.id, role: m.role as AccessRole, tenantId: m.tenant_id, agencyId: m.agency_id })),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** A one-time link that signs the person in and opens My account. */
export async function signInLink(email: string, origin: string): Promise<{ link: string; userId: string; created: boolean }> {
  const svc = serviceClient();
  const next = "/console?v=account";
  // An invite link creates the account; a person who already has one gets a
  // magic link instead (an invite for an existing email is refused).
  const invite = await svc.auth.admin.generateLink({ type: "invite", email });
  const res = invite.error ? await svc.auth.admin.generateLink({ type: "magiclink", email }) : invite;
  if (res.error || !res.data.user) throw new Error(res.error?.message ?? "Couldn't make a sign-in link.");
  const type = invite.error ? "magiclink" : "invite";
  const link = `${origin}/auth/confirm?token_hash=${encodeURIComponent(res.data.properties.hashed_token)}&type=${type}&next=${encodeURIComponent(next)}`;
  return { link, userId: res.data.user.id, created: !invite.error };
}

export async function addAccess(userId: string, a: { role: AccessRole; tenantId?: string | null; agencyId?: string | null }) {
  const svc = serviceClient();
  const tenantId = a.role === "tenant_admin" || a.role === "tenant_staff" ? (a.tenantId ?? null) : null;
  const agencyId = a.role === "agency_admin" ? (a.agencyId ?? null) : null;
  let q = svc.from("memberships").select("id").eq("user_id", userId).eq("role", a.role);
  q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
  q = agencyId ? q.eq("agency_id", agencyId) : q.is("agency_id", null);
  const { data: existing } = await q;
  if (existing?.length) return false;
  const { error } = await svc.from("memberships").insert({ user_id: userId, role: a.role, tenant_id: tenantId, agency_id: agencyId });
  if (error) throw new Error(error.message);
  return true;
}

export async function removeAccess(accessId: string) {
  const { error } = await serviceClient().from("memberships").delete().eq("id", accessId);
  if (error) throw new Error(error.message);
}

export async function accessOwner(accessId: string) {
  const { data } = await serviceClient().from("memberships").select("user_id, role, tenant_id").eq("id", accessId).maybeSingle();
  return data as { user_id: string; role: AccessRole; tenant_id: string | null } | null;
}

export async function countPlatformAdmins() {
  const { count } = await serviceClient().from("memberships").select("id", { count: "exact", head: true }).eq("role", "platform_admin");
  return count ?? 0;
}
