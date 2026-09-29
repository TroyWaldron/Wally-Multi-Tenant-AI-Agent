"use client";

import { useState } from "react";
import { KeyRound, Plus, UserPlus, X } from "lucide-react";
import { addPerson, grantAccess, newSignInLink, revokeAccess } from "@/app/console/people-actions";
import { ACCESS_ROLES, type AccessRole, type Person } from "@/lib/access";
import type { ConsoleData } from "../Console";
import { Button, Card, Field, inputClass, SectionTitle, Table, timeAgo, useAction } from "../ui";
import { CopyBox } from "./CopyBox";

/**
 * Everyone who can sign in to Wally and what each can reach. Wally team only.
 * Adding someone makes a one-time sign-in link to pass on; no email is sent.
 */
export function PeopleView({ data }: { data: ConsoleData }) {
  const { run, pending } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccessRole>("tenant_admin");
  const [scope, setScope] = useState<string>(data.tenants[0]?.id ?? "");
  const [link, setLink] = useState<{ email: string; link: string } | null>(null);

  if (data.mode !== "supabase") {
    return <Card title="People">Demo mode has one shared password. Connect Supabase to give people their own sign-in.</Card>;
  }

  const onLink = (r: { data?: unknown }) => setLink((r.data as { email: string; link: string }) ?? null);

  return (
    <div className="flex flex-col gap-6">
      {link && (
        <Card title={`Sign-in link for ${link.email}`}>
          <CopyBox text={link.link} label="sign-in link" />
          <p className="mt-2 text-xs text-slate/60">
            Send it to them yourself (WhatsApp or email). It works once and expires after a short while; make a new one any time with the key button. It opens My account, where they set a password.
          </p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setLink(null)}>Done</Button>
        </Card>
      )}

      <Card>
        <SectionTitle icon={UserPlus}>Add a person</SectionTitle>
        <form
          className="grid gap-4 md:grid-cols-[2fr_1.3fr_1.5fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addPerson(email, role, scopeFor(role, scope)), (r) => {
              setEmail("");
              onLink(r);
            });
          }}
        >
          <Field label="Email" htmlFor="pp-email">
            <input id="pp-email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@business.com" />
          </Field>
          <RolePicker id="pp-role" role={role} onRole={(r) => { setRole(r); setScope(defaultScope(r, data)); }} />
          <ScopePicker id="pp-scope" role={role} scope={scope} onScope={setScope} data={data} />
          <Button variant="accent" disabled={pending || !email.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </form>
        <p className="mt-3 text-xs text-slate/55">{ACCESS_ROLES.find((r) => r.role === role)?.hint}</p>
      </Card>

      <Card title="Who can sign in">
        <Table
          minWidth={720}
          columns={["Person", "Can reach", "Last signed in", ""]}
          empty="Nobody yet."
          rows={data.people.map((p) => [
            <span key="e" className="font-semibold text-ink">
              {p.email}
              {p.id === data.user.id && <span className="ml-1 text-xs font-normal text-slate/55">(you)</span>}
            </span>,
            <AccessList key="a" person={p} data={data} />,
            <span key="l" className="text-xs text-slate/65">{p.lastSignInAt ? timeAgo(p.lastSignInAt) : "Not yet"}</span>,
            <Button key="k" size="sm" variant="ghost" title="New sign-in link" aria-label={`New sign-in link for ${p.email}`} disabled={pending} onClick={() => run(() => newSignInLink(p.email), onLink)}>
              <KeyRound className="h-3.5 w-3.5" />
            </Button>,
          ])}
        />
      </Card>
    </div>
  );
}

function defaultScope(role: AccessRole, data: ConsoleData) {
  const needs = ACCESS_ROLES.find((r) => r.role === role)?.needs;
  return needs === "agency" ? (data.agencies[0]?.id ?? "") : needs === "tenant" ? (data.tenants[0]?.id ?? "") : "";
}

function scopeFor(role: AccessRole, scope: string) {
  return ACCESS_ROLES.find((r) => r.role === role)?.needs === "none" ? null : scope || null;
}

function RolePicker({ id, role, onRole }: { id: string; role: AccessRole; onRole: (r: AccessRole) => void }) {
  return (
    <Field label="Role" htmlFor={id}>
      <select id={id} className={inputClass} value={role} onChange={(e) => onRole(e.target.value as AccessRole)}>
        {ACCESS_ROLES.map((r) => (
          <option key={r.role} value={r.role}>{r.label}</option>
        ))}
      </select>
    </Field>
  );
}

function ScopePicker({ id, role, scope, onScope, data }: { id: string; role: AccessRole; scope: string; onScope: (s: string) => void; data: ConsoleData }) {
  const needs = ACCESS_ROLES.find((r) => r.role === role)?.needs;
  if (needs === "none") {
    return (
      <Field label="Where" htmlFor={id}>
        <input id={id} className={inputClass} value="All of Wally" disabled />
      </Field>
    );
  }
  const options = needs === "agency" ? data.agencies.map((a) => ({ id: a.id, name: a.name })) : data.tenants.map((t) => ({ id: t.id, name: t.name }));
  return (
    <Field label={needs === "agency" ? "Agency" : "Business"} htmlFor={id}>
      <select id={id} className={inputClass} value={scope} onChange={(e) => onScope(e.target.value)}>
        {!options.length && <option value="">None yet</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </Field>
  );
}

function AccessList({ person, data }: { person: Person; data: ConsoleData }) {
  const { run, pending } = useAction();
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<AccessRole>("tenant_staff");
  const [scope, setScope] = useState(defaultScope("tenant_staff", data));
  const name = (a: Person["access"][number]) => {
    const label = ACCESS_ROLES.find((r) => r.role === a.role)?.label ?? a.role;
    const where = a.tenantId ? data.tenants.find((t) => t.id === a.tenantId)?.name : a.agencyId ? data.agencies.find((g) => g.id === a.agencyId)?.name : null;
    return where ? `${label}, ${where}` : label;
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1.5">
        {person.access.map((a) => (
          <li key={a.id} className="flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 text-xs text-ink">
            {name(a)}
            <button type="button" aria-label={`Remove ${name(a)}`} className="text-slate/50 hover:text-coral" disabled={pending} onClick={() => run(() => revokeAccess(a.id))}>
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
        {!person.access.length && <li className="text-xs text-coral">No access</li>}
        <li>
          <button type="button" className="rounded-full px-2 py-1 text-xs font-semibold text-lagoon hover:underline" onClick={() => setAdding((x) => !x)}>
            {adding ? "Cancel" : "+ Add"}
          </button>
        </li>
      </ul>
      {adding && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => grantAccess(person.id, role, scopeFor(role, scope)), () => setAdding(false));
          }}
        >
          <RolePicker id={`ga-role-${person.id}`} role={role} onRole={(r) => { setRole(r); setScope(defaultScope(r, data)); }} />
          <ScopePicker id={`ga-scope-${person.id}`} role={role} scope={scope} onScope={setScope} data={data} />
          <Button size="sm" variant="secondary" disabled={pending}>Give access</Button>
        </form>
      )}
    </div>
  );
}
