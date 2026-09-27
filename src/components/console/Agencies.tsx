"use client";

import { useState } from "react";
import { Handshake, Plus, X } from "lucide-react";
import { createAgency, inviteAgencyAdmin, removeAgencyInvite, saveAgency } from "@/app/console/actions";
import type { AgencyView, ConsoleData } from "./Console";
import { Button, Card, Field, inputClass, money, Pill, SectionTitle, Table, useAction } from "./ui";

/**
 * Agencies resell Wally under their own name. The Wally team sees every
 * agency and sets the margin; an agency admin sees only their own, with their
 * clients, what each pays and the agency's share.
 */
export function AgenciesSection({ data }: { data: ConsoleData }) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const list = data.isPlatformAdmin ? data.agencies : data.agencies.filter((a) => data.agencyIds.includes(a.id));
  if (!data.isPlatformAdmin && !list.length) return null;

  return (
    <div>
      <SectionTitle icon={Handshake}>{data.isPlatformAdmin ? "Agencies" : "Your agency"}</SectionTitle>
      <div className="flex flex-col gap-4">
        {list.map((a) => (
          <AgencyCard key={a.id} agency={a} admin={data.isPlatformAdmin} />
        ))}
        {data.isPlatformAdmin && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => createAgency(name), () => setName(""));
            }}
          >
            <input className={`${inputClass} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} placeholder="New agency name" aria-label="New agency name" />
            <Button variant="secondary" disabled={pending || !name.trim()}>
              <Plus className="h-4 w-4" /> Add agency
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function totals(a: AgencyView) {
  const by: Record<string, number> = {};
  for (const c of a.clients) by[c.currency] = (by[c.currency] ?? 0) + c.monthlyPrice;
  return Object.entries(by);
}

function AgencyCard({ agency, admin }: { agency: AgencyView; admin: boolean }) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState(false);
  const [a, setA] = useState(agency);
  const [email, setEmail] = useState("");
  const b = (k: keyof AgencyView["branding"], v: string) => setA((x) => ({ ...x, branding: { ...x.branding, [k]: v } }));
  const share = (n: number) => Math.round(n * agency.marginPct) / 100;

  return (
    <Card
      title={
        <span className="flex w-full flex-wrap items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: agency.branding.color ?? "#1c7f7a" }} />
          {agency.name}
          {agency.branding.brandName && <span className="text-xs font-normal text-slate/55">sold as {agency.branding.brandName}</span>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing((x) => !x)}>
            {editing ? "Close" : "Edit"}
          </Button>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <Table
          minWidth={480}
          columns={["Client", "Status", "Price / month", `Agency keeps (${agency.marginPct}%)`]}
          empty="No clients yet. Onboard one below."
          rows={agency.clients.map((c) => [
            <a key="n" href={`/console?t=${c.slug}`} className="font-semibold text-ink hover:text-lagoon">{c.name}</a>,
            <Pill key="s" status={c.status} />,
            <span key="p" className="tabular-nums">{money(c.monthlyPrice, c.currency)}</span>,
            <span key="m" className="tabular-nums">{money(share(c.monthlyPrice), c.currency)}</span>,
          ])}
        />
        {agency.clients.length > 1 && (
          <p className="text-xs text-slate/60">
            Total:{" "}
            {totals(agency)
              .map(([cur, n]) => `${money(n, cur)} a month, agency keeps ${money(share(n), cur)}`)
              .join("; ")}
          </p>
        )}

        {editing && (
          <form
            className="grid gap-4 border-t border-ink/8 pt-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveAgency(agency.id, { name: a.name, supportEmail: a.supportEmail, branding: a.branding, marginPct: a.marginPct }), () => setEditing(false));
            }}
          >
            <Field label="Brand name clients see" htmlFor={`ag-brand-${agency.id}`} hint="Replaces Wally in the console for this agency and its clients. Leave blank to show Wally.">
              <input id={`ag-brand-${agency.id}`} className={inputClass} value={a.branding.brandName ?? ""} onChange={(e) => b("brandName", e.target.value)} />
            </Field>
            <Field label="Widget footer" htmlFor={`ag-foot-${agency.id}`} hint={'Shown under every client’s chat, e.g. "Powered by Novate". Blank uses the brand name.'}>
              <input id={`ag-foot-${agency.id}`} className={inputClass} value={a.branding.poweredBy ?? ""} onChange={(e) => b("poweredBy", e.target.value)} />
            </Field>
            <Field label="Brand colour" htmlFor={`ag-color-${agency.id}`}>
              <div className="flex gap-2">
                <input type="color" aria-label="Pick brand colour" className="h-9 w-12 cursor-pointer rounded-lg border border-ink/15" value={a.branding.color ?? "#1c7f7a"} onChange={(e) => b("color", e.target.value)} />
                <input id={`ag-color-${agency.id}`} className={inputClass} value={a.branding.color ?? ""} onChange={(e) => b("color", e.target.value)} />
              </div>
            </Field>
            <Field label="Logo URL" htmlFor={`ag-logo-${agency.id}`}>
              <input id={`ag-logo-${agency.id}`} className={inputClass} value={a.branding.logo ?? ""} onChange={(e) => b("logo", e.target.value)} placeholder="https://…/logo.png" />
            </Field>
            <Field label="Support email" htmlFor={`ag-email-${agency.id}`}>
              <input id={`ag-email-${agency.id}`} className={inputClass} value={a.supportEmail ?? ""} onChange={(e) => setA({ ...a, supportEmail: e.target.value })} />
            </Field>
            <Field label="Agency margin (%)" htmlFor={`ag-margin-${agency.id}`} hint={admin ? "Share of each client's price the agency keeps." : "Set by the Wally team."}>
              <input id={`ag-margin-${agency.id}`} type="number" min={0} max={90} className={inputClass} disabled={!admin} value={a.marginPct} onChange={(e) => setA({ ...a, marginPct: Number(e.target.value) })} />
            </Field>
            {admin && (
              <Field label="Agency name" htmlFor={`ag-name-${agency.id}`}>
                <input id={`ag-name-${agency.id}`} className={inputClass} value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} />
              </Field>
            )}
            <div className="sm:col-span-2">
              <Button variant="accent" disabled={pending}>{pending ? "Saving…" : "Save agency"}</Button>
            </div>
          </form>
        )}

        {editing && admin && (
          <div className="border-t border-ink/8 pt-4">
            <div className="mb-2 text-xs font-semibold text-ink/80">Agency admins waiting to sign in</div>
            <ul className="mb-3 flex flex-wrap gap-2">
              {agency.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-1 rounded-full bg-paper px-3 py-1 text-xs text-ink">
                  {i.email}
                  <button type="button" aria-label={`Remove ${i.email}`} className="text-slate/50 hover:text-coral" onClick={() => run(() => removeAgencyInvite(agency.id, i.id))}>
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
              {!agency.invites.length && <li className="text-xs text-slate/55">None. People who already signed in are admins.</li>}
            </ul>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => inviteAgencyAdmin(agency.id, email), () => setEmail(""));
              }}
            >
              <input className={`${inputClass} max-w-xs`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@agency.com" aria-label="Admin email" />
              <Button variant="secondary" size="sm" disabled={pending || !email.trim()}>Add admin</Button>
            </form>
            <p className="mt-2 text-xs text-slate/55">They become an admin of this agency the first time they sign in to Wally with that email. No email is sent.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
