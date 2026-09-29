"use client";

import { useState } from "react";
import { changeMyPassword } from "@/app/console/people-actions";
import type { ConsoleData } from "../Console";
import { Button, Card, Field, inputClass, useAction } from "../ui";

const ROLE_NAMES: Record<string, string> = {
  platform_admin: "Wally team",
  agency_admin: "Agency admin",
  tenant_admin: "Business admin",
  tenant_staff: "Business staff",
};

/** Your own sign-in: who you are, what you can reach, and your password. */
export function AccountView({ data }: { data: ConsoleData }) {
  const { run, pending } = useAction();
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const me = data.people.find((p) => p.id === data.user.id);
  const reach = me
    ? me.access.map((a) => {
        const where = a.tenantId ? data.tenants.find((t) => t.id === a.tenantId)?.name : a.agencyId ? data.agencies.find((g) => g.id === a.agencyId)?.name : "all of Wally";
        return `${ROLE_NAMES[a.role] ?? a.role}${where ? `, ${where}` : ""}`;
      })
    : [data.isPlatformAdmin ? "Wally team, all of Wally" : data.agencyIds.length ? "Agency admin" : `Member of ${data.tenants.map((t) => t.name).join(", ") || "no business yet"}`];

  return (
    <div className="grid max-w-3xl gap-6">
      <Card title="You">
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate/60">Email</dt>
          <dd className="font-semibold text-ink">{data.user.email}</dd>
          <dt className="text-slate/60">Access</dt>
          <dd className="text-ink">{reach.join("; ")}</dd>
        </dl>
      </Card>

      {data.mode === "supabase" && (
        <Card title="Password">
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => changeMyPassword(pw), () => {
                setPw("");
                setAgain("");
              });
            }}
          >
            <Field label="New password" htmlFor="acct-pw" hint="At least 10 characters.">
              <input id="acct-pw" type="password" autoComplete="new-password" className={inputClass} value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Field label="Type it again" htmlFor="acct-pw2">
              <input id="acct-pw2" type="password" autoComplete="new-password" className={inputClass} value={again} onChange={(e) => setAgain(e.target.value)} />
            </Field>
            <div className="sm:col-span-2 flex items-center gap-3">
              <Button variant="accent" disabled={pending || pw.length < 10 || pw !== again}>{pending ? "Saving…" : "Save password"}</Button>
              {again && pw !== again && <span className="text-xs text-coral">The two don&apos;t match.</span>}
            </div>
          </form>
          <p className="mt-3 text-xs text-slate/55">If you came in with a sign-in link, set a password here so you can sign in with your email next time.</p>
        </Card>
      )}
    </div>
  );
}
