"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Palette, Plus, Sparkles } from "lucide-react";
import { createTenant, loadStarterData, saveTenant } from "@/app/console/actions";
import type { Tenant } from "@/lib/types";
import type { ConsoleData } from "../Console";
import { Button, Card, Empty, Field, inputClass, Pill, SectionTitle, Table, useAction } from "../ui";

export function BusinessView({ data }: { data: ConsoleData }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [newName, setNewName] = useState("");

  return (
    <div className="flex flex-col gap-8">
      {!data.tenant && (
        <Empty
          title="No businesses yet"
          action={
            data.isPlatformAdmin && data.mode === "supabase" ? (
              <Button variant="accent" disabled={pending} onClick={() => run(() => loadStarterData(), (r) => router.push(`/console?t=${r.data}`))}>
                <Sparkles className="h-4 w-4" /> Set up Sunsational Tobago
              </Button>
            ) : undefined
          }
        >
          {data.isPlatformAdmin
            ? "Load Sunsational Tobago with a receptionist, an accountant, a coordinator and its FAQ as knowledge, or add a new business below."
            : "Ask your Wally admin to give you access to a business."}
        </Empty>
      )}

      {data.tenant && <TenantEditor key={data.tenant.id} tenant={data.tenant} />}

      {data.isPlatformAdmin && (
        <div>
          <SectionTitle icon={Building2}>All businesses</SectionTitle>
          <Table
            minWidth={420}
            columns={["Business", "Status", ""]}
            empty="None yet."
            rows={data.tenants.map((t) => [
              <span key="n" className="font-semibold text-ink">{t.name}</span>,
              <Pill key="s" status={t.status} />,
              <Button key="o" size="sm" variant="ghost" onClick={() => router.push(`/console?t=${t.slug}`)}>Open</Button>,
            ])}
          />
          <Card className="mt-4" title="Add a business">
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => createTenant(newName), (r) => { setNewName(""); router.push(`/console?t=${r.data}`); }); }}>
              <input id="new-tenant" className={`${inputClass} max-w-sm`} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Business name" />
              <Button variant="accent" disabled={pending || !newName.trim()}><Plus className="h-4 w-4" /> Add</Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

function TenantEditor({ tenant }: { tenant: Tenant }) {
  const { run, pending } = useAction();
  const [t, setT] = useState(tenant);
  const p = (k: keyof Tenant["profile"], v: string) => setT((x) => ({ ...x, profile: { ...x.profile, [k]: v } }));
  const b = <K extends keyof Tenant["branding"]>(k: K, v: Tenant["branding"][K]) => setT((x) => ({ ...x, branding: { ...x.branding, [k]: v } }));

  return (
    <form
      className="grid gap-6 lg:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveTenant(tenant.id, { name: t.name, industry: t.industry, currency: t.currency, timezone: t.timezone, status: t.status, profile: t.profile, branding: t.branding }));
      }}
    >
      <Card title={<span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-amber" /> Business profile</span>}>
        <div className="flex flex-col gap-4">
          <p className="text-xs text-slate/55">Agents use this to answer basic questions and sign off correctly.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="t-name"><input id="t-name" className={inputClass} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
            <Field label="Industry" htmlFor="t-ind"><input id="t-ind" className={inputClass} value={t.industry ?? ""} onChange={(e) => setT({ ...t, industry: e.target.value })} /></Field>
            <Field label="Currency" htmlFor="t-cur">
              <select id="t-cur" className={inputClass} value={t.currency} onChange={(e) => setT({ ...t, currency: e.target.value })}>
                <option value="TTD">TT$ (TTD)</option><option value="USD">US$ (USD)</option><option value="BBD">BBD</option><option value="JMD">JMD</option><option value="XCD">EC$ (XCD)</option>
              </select>
            </Field>
            <Field label="Lease status" htmlFor="t-status">
              <select id="t-status" className={inputClass} value={t.status} onChange={(e) => setT({ ...t, status: e.target.value as Tenant["status"] })}>
                <option value="trial">Trial</option><option value="active">Active</option><option value="paused">Paused</option><option value="offboarded">Offboarded</option>
              </select>
            </Field>
          </div>
          <Field label="About" htmlFor="t-about"><textarea id="t-about" rows={3} className={inputClass} value={t.profile.about ?? ""} onChange={(e) => p("about", e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Opening hours" htmlFor="t-hours"><input id="t-hours" className={inputClass} value={t.profile.hours ?? ""} onChange={(e) => p("hours", e.target.value)} /></Field>
            <Field label="Phone" htmlFor="t-phone"><input id="t-phone" className={inputClass} value={t.profile.phone ?? ""} onChange={(e) => p("phone", e.target.value)} /></Field>
            <Field label="Email" htmlFor="t-email"><input id="t-email" className={inputClass} value={t.profile.email ?? ""} onChange={(e) => p("email", e.target.value)} /></Field>
            <Field label="Website" htmlFor="t-web"><input id="t-web" className={inputClass} value={t.profile.website ?? ""} onChange={(e) => p("website", e.target.value)} /></Field>
          </div>
          <Field label="Address" htmlFor="t-addr"><input id="t-addr" className={inputClass} value={t.profile.address ?? ""} onChange={(e) => p("address", e.target.value)} /></Field>
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Palette className="h-4 w-4 text-amber" /> Widget branding</span>}>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand colour" htmlFor="t-color">
              <div className="flex gap-2">
                <input type="color" aria-label="Pick brand colour" className="h-9 w-12 cursor-pointer rounded-lg border border-ink/15" value={t.branding.color ?? "#1c7f7a"} onChange={(e) => b("color", e.target.value)} />
                <input id="t-color" className={inputClass} value={t.branding.color ?? ""} onChange={(e) => b("color", e.target.value)} />
              </div>
            </Field>
            <Field label="Position" htmlFor="t-pos">
              <select id="t-pos" className={inputClass} value={t.branding.position ?? "right"} onChange={(e) => b("position", e.target.value as "left" | "right")}>
                <option value="right">Bottom right</option><option value="left">Bottom left</option>
              </select>
            </Field>
          </div>
          <Field label="Welcome message" htmlFor="t-welcome"><textarea id="t-welcome" rows={3} className={inputClass} value={t.branding.welcome ?? ""} onChange={(e) => b("welcome", e.target.value)} /></Field>
          <div>
            <div className="mb-2 text-xs font-semibold text-ink/80">Preview</div>
            <div className="rounded-2xl border border-ink/10 bg-paper p-4">
              <div className="overflow-hidden rounded-xl bg-white shadow">
                <div className="px-4 py-3 text-sm font-semibold text-white" style={{ background: t.branding.color ?? "#1c7f7a" }}>{t.name}</div>
                <div className="p-4"><div className="inline-block max-w-[85%] rounded-2xl border border-ink/8 px-3 py-2 text-sm text-ink">{t.branding.welcome || "Hi, how can we help?"}</div></div>
              </div>
            </div>
          </div>
          <div className="text-xs text-slate/55">Widget key: <code className="font-mono text-ink">{tenant.publicKey}</code></div>
        </div>
      </Card>

      <div className="lg:col-span-2"><Button variant="accent" disabled={pending}>{pending ? "Saving…" : "Save business"}</Button></div>
    </form>
  );
}
