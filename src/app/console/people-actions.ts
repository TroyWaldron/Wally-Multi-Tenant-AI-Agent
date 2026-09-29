"use server";

// Wally-level actions: people and their access, and your own account.
// People are managed by the Wally team only; anyone signed in can change
// their own password.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ACCESS_ROLES, accessOwner, addAccess, countPlatformAdmins, removeAccess, signInLink, type AccessRole } from "@/lib/people";
import { getSession, systemStore } from "@/lib/session";
import { isSupabaseConfigured, userClient } from "@/lib/supabase";
import type { ActionResult } from "./actions";

async function wallyTeam() {
  const session = await getSession();
  if (!session) throw new Error("Your session expired. Sign in again.");
  if (!session.isPlatformAdmin) throw new Error("Only the Wally team can manage people.");
  if (!isSupabaseConfigured()) throw new Error("People need Supabase connected (demo mode has one shared password).");
  return session;
}

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost:3000"}`;
}

async function wrap(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const r = await fn();
    revalidatePath("/console");
    return r;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

async function auditFor(tenantId: string | null, actor: string, action: string, detail: Record<string, unknown>) {
  // Business-level access changes show in that business's audit log.
  if (!tenantId) return;
  await systemStore().audit(tenantId, { actorType: "user", actor, action, detail });
}

export async function addPerson(email: string, role: AccessRole, scopeId: string | null) {
  return wrap(async () => {
    const session = await wallyTeam();
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: "Enter a valid email address." };
    const def = ACCESS_ROLES.find((r) => r.role === role);
    if (!def) return { ok: false, error: "Pick what they can reach." };
    if (def.needs !== "none" && !scopeId) return { ok: false, error: def.needs === "agency" ? "Pick the agency." : "Pick the business." };
    const { link, userId, created } = await signInLink(e, await origin());
    const tenantId = def.needs === "tenant" ? scopeId : null;
    await addAccess(userId, { role, tenantId, agencyId: def.needs === "agency" ? scopeId : null });
    await auditFor(tenantId, session.user.email, "person.access_added", { email: e, role });
    return { ok: true, message: created ? `${e} added. Send them the sign-in link.` : `${e} already had an account; access added.`, data: { email: e, link } };
  });
}

export async function newSignInLink(email: string) {
  return wrap(async () => {
    await wallyTeam();
    const { link } = await signInLink(email.trim().toLowerCase(), await origin());
    return { ok: true, data: { email, link } };
  });
}

export async function grantAccess(userId: string, role: AccessRole, scopeId: string | null) {
  return wrap(async () => {
    const session = await wallyTeam();
    const def = ACCESS_ROLES.find((r) => r.role === role);
    if (!def) return { ok: false, error: "Pick what they can reach." };
    if (def.needs !== "none" && !scopeId) return { ok: false, error: def.needs === "agency" ? "Pick the agency." : "Pick the business." };
    const tenantId = def.needs === "tenant" ? scopeId : null;
    const added = await addAccess(userId, { role, tenantId, agencyId: def.needs === "agency" ? scopeId : null });
    await auditFor(tenantId, session.user.email, "person.access_added", { userId, role });
    return { ok: true, message: added ? "Access added." : "They already have that." };
  });
}

export async function revokeAccess(accessId: string) {
  return wrap(async () => {
    const session = await wallyTeam();
    const owner = await accessOwner(accessId);
    if (!owner) return { ok: true };
    // Never lock the Wally team out of Wally.
    if (owner.role === "platform_admin" && (await countPlatformAdmins()) <= 1) return { ok: false, error: "Wally needs at least one person on the Wally team." };
    if (owner.role === "platform_admin" && owner.user_id === session.user.id) return { ok: false, error: "Ask another Wally team member to remove your own Wally team access." };
    await removeAccess(accessId);
    await auditFor(owner.tenant_id, session.user.email, "person.access_removed", { userId: owner.user_id, role: owner.role });
    return { ok: true, message: "Access removed." };
  });
}

export async function changeMyPassword(password: string) {
  return wrap(async () => {
    const session = await getSession();
    if (!session || session.mode !== "supabase") return { ok: false, error: "Sign in first." };
    if (password.length < 10) return { ok: false, error: "Use at least 10 characters." };
    const { error } = await (await userClient()).auth.updateUser({ password });
    if (error) return { ok: false, error: error.message };
    return { ok: true, message: "Password saved. Use it with your email next time." };
  });
}
