"use client";

import { BarChart3, Coins, Target, TrendingUp } from "lucide-react";
import type { TenantData } from "../Console";
import { cardClass, MetricCard, money, SectionTitle, Table, timeAgo, usd } from "../ui";

export function OutcomesView({ data }: { data: TenantData }) {
  const since30 = data.now - 30 * 86_400_000;
  const recent = data.outcomes.filter((o) => new Date(o.createdAt).getTime() >= since30);
  const byKind = Object.entries(
    recent.reduce<Record<string, { count: number; value: number }>>((acc, o) => {
      acc[o.kind] ??= { count: 0, value: 0 };
      acc[o.kind].count++;
      acc[o.kind].value += o.value;
      return acc;
    }, {})
  ).sort((a, b) => b[1].count - a[1].count);
  const month = data.usage.filter((u) => u.createdAt >= data.monthStart);
  const spend = month.reduce((s, u) => s + u.costUsd, 0);
  const value = recent.reduce((s, o) => s + o.value, 0);
  const tokens = month.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0);
  const maxCount = Math.max(1, ...byKind.map(([, v]) => v.count));

  const r = data.roi;
  return (
    <div className="flex flex-col gap-8">
      <div>
        <SectionTitle icon={TrendingUp}>Return on investment, last {r.days} days</SectionTitle>
        <div className={`${cardClass} p-5`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="font-heading text-3xl font-bold text-ink">{r.multiple === null ? "Not priced" : `${r.multiple}x`}</div>
              <div className="text-xs text-slate/60">{r.multiple === null ? "Add an agreement under Pricing & Billing" : `back for every ${money(1, r.currency).replace(/\.00$/, "")} spent`}</div>
            </div>
            <div>
              <div className="font-heading text-2xl font-bold text-ink">{r.hoursSaved} h</div>
              <div className="text-xs text-slate/60">staff time saved ({r.handledAlone} chats handled alone)</div>
            </div>
            <div>
              <div className="font-heading text-2xl font-bold text-ink">{money(r.staffCostSaved + r.outcomeValue, r.currency)}</div>
              <div className="text-xs text-slate/60">value: {money(r.staffCostSaved, r.currency)} staff time{r.outcomeValue ? ` + ${money(r.outcomeValue, r.currency)} outcomes` : ""}</div>
            </div>
            <div>
              <div className="font-heading text-2xl font-bold text-ink">{money(r.cost, r.currency)}</div>
              <div className="text-xs text-slate/60">monthly price (US${r.costUsd}) · {r.afterHours} chats after hours</div>
            </div>
          </div>
          <p className="mt-4 text-[11px] text-slate/50">
            Worked out at {r.assumptions.minutesPerChat} minutes of staff time per chat, {money(r.assumptions.hourlyCost, r.currency)} an hour and {r.assumptions.fxPerUsd} {r.currency} per US$1. Change these under Settings.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Target} label="Outcomes (30d)" value={recent.length} />
        <MetricCard icon={TrendingUp} label="Outcome value (30d)" value={money(value, data.tenant.currency)} />
        <MetricCard icon={Coins} label="AI spend this month" value={usd(spend)} accent />
        <MetricCard icon={BarChart3} label="Tokens this month" value={`${(tokens / 1000).toFixed(0)}k`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle icon={Target}>What your agents achieved (30 days)</SectionTitle>
          <div className={`${cardClass} flex flex-col gap-3 p-5`}>
            {byKind.length === 0 && <p className="text-sm text-slate/50">No outcomes yet. Agents log leads, bookings and resolved tickets as they work.</p>}
            {byKind.map(([kind, v]) => (
              <div key={kind}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-semibold capitalize text-ink">{kind.replace(/_/g, " ")}</span>
                  <span className="tabular-nums text-slate/60">{v.count}{v.value ? ` · ${money(v.value, data.tenant.currency)}` : ""}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink/6"><div className="h-full rounded-full bg-lagoon" style={{ width: `${(v.count / maxCount) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle icon={Coins}>Spend by agent this month</SectionTitle>
          <Table
            minWidth={420}
            columns={["Agent", "Spent", "Budget", "Outcomes (30d)"]}
            empty="No agents."
            rows={data.agents.map((a) => {
              const s = month.filter((u) => u.agentId === a.id).reduce((x, u) => x + u.costUsd, 0);
              return [a.name, <span key="s" className="tabular-nums">{usd(s)}</span>, <span key="b" className="tabular-nums">{usd(a.monthlyBudgetUsd)}</span>, recent.filter((o) => o.agentId === a.id).length];
            })}
          />
          <p className="mt-3 text-xs text-slate/50">Hybrid pricing (flat lease plus per-outcome fee), voice-minute metering and client invoices build on these numbers in phase 4.</p>
        </div>
      </div>

      <div>
        <SectionTitle icon={BarChart3}>Outcome log</SectionTitle>
        <Table
          columns={["What", "Value", "Agent", "Note", "When"]}
          empty="Nothing logged yet."
          rows={data.outcomes.slice(0, 50).map((o) => [
            <span key="k" className="capitalize">{o.kind.replace(/_/g, " ")}</span>,
            o.value ? money(o.value, o.currency) : "",
            data.agents.find((a) => a.id === o.agentId)?.name ?? "n8n / system",
            <span key="n" className="line-clamp-1 max-w-xs">{o.note}</span>,
            timeAgo(o.createdAt),
          ])}
        />
      </div>
    </div>
  );
}
