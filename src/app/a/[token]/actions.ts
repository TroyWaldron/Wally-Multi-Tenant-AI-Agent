"use server";

import { revalidatePath } from "next/cache";
import { readApprovalToken } from "@/lib/approvalLinks";
import { decide } from "@/lib/approvals";
import { systemStore } from "@/lib/session";

export type LinkResult = { ok: boolean; message: string } | null;

export async function decideFromLink(token: string, _prev: LinkResult, form: FormData): Promise<LinkResult> {
  const t = readApprovalToken(token);
  if (!t) return { ok: false, message: "This link has expired. Open the approval in the Wally console instead." };
  const decision = form.get("decision") === "approved" ? "approved" : "rejected";
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  const store = systemStore();
  const tenant = await store.getTenant(t.tenantId);
  if (!tenant) return { ok: false, message: "This business is no longer on Wally." };
  const r = await decide(store, tenant, t.approvalId, decision, `${name || "Someone"} (review link)`, String(form.get("reason") ?? "") || undefined);
  revalidatePath(`/a/${token}`);
  return r.ok ? { ok: true, message: decision === "approved" ? "Approved. It's being done now." : "Declined. The AI staff member has been told." } : { ok: false, message: r.error };
}
