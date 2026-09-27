"use client";

import { useState, type FormEvent } from "react";
import { FileSignature, Layers, Pencil, Receipt, Sparkles, Trash2, TrendingUp, Wallet } from "lucide-react";
import { deleteContract, saveContract } from "@/app/console/actions";
import { contractActiveOn, monthCharge, PRICE_TIERS, suggestedPlan, tierFor } from "@/lib/billing";
import { getRole } from "@/lib/roles";
import type { Contract } from "@/lib/types";
import type { TenantData } from "../Console";
import { Button, Card, Field, inputClass, MetricCard, Pill, SectionTitle, Table, useAction, usd } from "../ui";

type Draft = Omit<Contract, "id" | "tenantId" | "createdAt"> & { id?: string };

function price(value: number, currency: string) {
  const sym = currency === "USD" ? "US$" : currency === "TTD" ? "TT$" : `${currency} `;
  return `${sym}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * What each business pays Wally, as agreed in its contract. The Wally team
 * sets prices here; the business sees the same agreement (read-only) and
 * its own back office shows it through the partner API.
 */
export function BillingView({ data }: { data: TenantData }) {
  const { run, pending } = useAction();
  const admin = data.isPlatformAdmin;
  const today = new Date(data.now).toISOString().slice(0, 10);
  // A new agreement is priced from the AI employee's role: a receptionist
  // costs less than a coordinator, a manager or a CEO.
  const planFor = (agentId: string | null) => {
    const agent = data.agents.find((a) => a.id === agentId);
    return suggestedPlan(agent?.templateKey, agent ? getRole(agent.templateKey)?.name : "Staff team");
  };
  const firstLive = data.agents.find((a) => a.status === "live")?.id ?? null;
  const blank = (): Draft => ({
    agentId: firstLive,
    ...planFor(firstLive),
    startsOn: today,
    endsOn: null,
    status: "active",
    notes: null,
  });
  const [draft, setDraft] = useState<Draft | null>(null);

  const lines = data.contracts.map((c) => {
    const used = data.billableThisMonth[c.agentId ?? "all"] ?? 0;
    return { c, charge: monthCharge(c, used), live: contractActiveOn(c, today) };
  });
  const active = lines.filter((l) => l.live);
  const currencies = [...new Set(active.map((l) => l.c.currency))];
  const oneCurrency = currencies.length === 1 ? currencies[0] : null;
  const billed = active.reduce((s, l) => s + l.charge.total, 0);
  const aiCost = data.usage.filter((u) => u.createdAt >= data.monthStart).reduce((s, u) => s + u.costUsd, 0);

  function save(e: FormEvent) {
    e.preventDefault();
    if (draft) run(() => saveContract(data.tenant.id, draft), () => setDraft(null));
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const agentName = (id: string | null) => (id ? data.agents.find((a) => a.id === id)?.name ?? "Removed agent" : "Whole business");

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Receipt} label="Billed this month" value={oneCurrency ? price(billed, oneCurrency) : active.length ? "Mixed" : "Not set"} hint="What the business owes Wally so far" />
        <MetricCard icon={FileSignature} label="Active agreements" value={active.length} />
        {admin && <MetricCard icon={Wallet} label="AI cost to Wally" value={usd(aiCost)} hint="Model providers, this month. Only the Wally team sees this." accent />}
        {admin && oneCurrency === "USD" && (
          <MetricCard icon={TrendingUp} label="Margin this month" value={usd(billed - aiCost)} hint={billed ? `${Math.round(((billed - aiCost) / billed) * 100)}% of the bill` : undefined} />
        )}
      </div>

      <div>
        <SectionTitle
          icon={FileSignature}
          action={admin && !draft ? <Button onClick={() => setDraft(blank())}>Add agreement</Button> : undefined}
        >
          Agreements
        </SectionTitle>
        <Table
          minWidth={760}
          columns={["Plan", "Covers", "Monthly fee", "Included", "Extra each", "This month", "Status", ""]}
          empty={admin ? "No agreement yet. Add one to set what this business pays." : "No agreement set up yet. The Wally team will add yours."}
          rows={lines.map(({ c, charge, live }) => [
            <div key="p">
              <div className="font-semibold text-ink">{c.planName}</div>
              <div className="text-xs text-slate/55">
                From {c.startsOn}
                {c.endsOn ? ` to ${c.endsOn}` : ""}
                {c.setupFee ? ` · setup ${price(c.setupFee, c.currency)}` : ""}
              </div>
            </div>,
            agentName(c.agentId),
            <span key="f" className="tabular-nums">{price(c.monthlyFee, c.currency)}</span>,
            <span key="i" className="tabular-nums">{c.includedConversations} chats</span>,
            <span key="o" className="tabular-nums">{price(c.overageRate, c.currency)}</span>,
            <div key="m" className="tabular-nums">
              <div className="font-semibold text-ink">{price(charge.total, c.currency)}</div>
              <div className="text-xs text-slate/55">
                {charge.conversations} of {charge.included} chats{charge.extra ? `, ${charge.extra} extra` : ""}
              </div>
            </div>,
            <Pill key="s" status={live ? "active" : "closed"} label={live ? "active" : c.status === "ended" ? "ended" : "not started"} />,
            admin ? (
              <div key="a" className="flex gap-2">
                <button onClick={() => setDraft({ ...c })} className="text-ink/40 hover:text-lagoon" aria-label="Edit agreement"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => run(() => deleteContract(data.tenant.id, c.id))} className="text-ink/30 hover:text-coral" aria-label="Remove agreement"><Trash2 className="h-4 w-4" /></button>
              </div>
            ) : (
              ""
            ),
          ])}
        />
        <p className="mt-3 text-xs text-slate/50">
          A chat counts once per guest conversation started this month on a real channel (website, WhatsApp and so on). Playground tests and helpdesk tickets are never billed.
        </p>
      </div>

      <div>
        <SectionTitle icon={Layers}>Introductory prices by role</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PRICE_TIERS.map((t) => (
            <Card key={t.key} title={t.name}>
              <div className="font-heading text-2xl font-bold text-ink tabular-nums">{price(t.monthlyFee, "USD")}<span className="text-sm font-normal text-slate/55"> a month</span></div>
              <div className="mt-1 text-xs text-slate/60">{t.includedConversations} chats or tasks included, then {price(t.overageRate, "USD")} each</div>
              <div className="mt-3 text-xs text-slate/70">{t.roles.map((k) => getRole(k)?.name ?? k).join(", ")}</div>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate/50">Per AI employee. No setup fee while introductory pricing runs.</p>
      </div>

      {admin && draft && (
        <Card title={draft.id ? "Edit agreement" : "New agreement"}>
          {!draft.id && (
            <p className="mb-4 flex items-start gap-2 rounded-xl bg-lagoon/8 p-3 text-xs text-slate/80">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lagoon" />
              Prefilled with the introductory {tierFor(data.agents.find((a) => a.id === draft.agentId)?.templateKey).name.toLowerCase()} price for this AI employee. Change who it covers and the price follows the role; edit any figure to match the contract.
            </p>
          )}
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Plan name">
              <input className={inputClass} value={draft.planName} onChange={(e) => set("planName", e.target.value)} required />
            </Field>
            <Field label="Covers">
              <select
                className={inputClass}
                value={draft.agentId ?? ""}
                onChange={(e) => {
                  const agentId = e.target.value || null;
                  setDraft((d) => (d ? { ...d, agentId, ...(d.id ? {} : planFor(agentId)) } : d));
                }}
              >
                {data.agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
                <option value="">Whole business</option>
              </select>
            </Field>
            <Field label="Currency">
              <select className={inputClass} value={draft.currency} onChange={(e) => set("currency", e.target.value)}>
                <option value="USD">US dollars</option>
                <option value="TTD">TT dollars</option>
              </select>
            </Field>
            <Field label="Monthly fee">
              <input className={inputClass} type="number" min="0" step="0.01" value={draft.monthlyFee} onChange={(e) => set("monthlyFee", Number(e.target.value))} />
            </Field>
            <Field label="Chats included each month">
              <input className={inputClass} type="number" min="0" step="1" value={draft.includedConversations} onChange={(e) => set("includedConversations", Number(e.target.value))} />
            </Field>
            <Field label="Price per extra chat">
              <input className={inputClass} type="number" min="0" step="0.01" value={draft.overageRate} onChange={(e) => set("overageRate", Number(e.target.value))} />
            </Field>
            <Field label="One-off setup fee">
              <input className={inputClass} type="number" min="0" step="0.01" value={draft.setupFee} onChange={(e) => set("setupFee", Number(e.target.value))} />
            </Field>
            <Field label="Starts">
              <input className={inputClass} type="date" value={draft.startsOn} onChange={(e) => set("startsOn", e.target.value)} required />
            </Field>
            <Field label="Ends" hint="Leave empty for a rolling monthly agreement.">
              <input className={inputClass} type="date" value={draft.endsOn ?? ""} onChange={(e) => set("endsOn", e.target.value || null)} />
            </Field>
            <Field label="Status">
              <select className={inputClass} value={draft.status} onChange={(e) => set("status", e.target.value as Contract["status"])}>
                <option value="active">Active</option>
                <option value="ended">Ended</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes" hint="Contract reference, discounts, payment terms.">
                <input className={inputClass} value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
              </Field>
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save agreement"}</Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
