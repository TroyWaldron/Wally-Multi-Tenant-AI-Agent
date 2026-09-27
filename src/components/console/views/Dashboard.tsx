"use client";

import { AlertTriangle, Bot, ClipboardCheck, Coins, Inbox, ScrollText, TrendingUp } from "lucide-react";
import type { TenantData, ViewId } from "../Console";
import { HEALTH_LABEL } from "@/lib/team";
import { HEALTH_DOT } from "../OrgChart";
import { Card, cardClass, MetricCard, money, Pill, SectionTitle, timeAgo, usd } from "../ui";

export function DashboardView({ data, onNavigate }: { data: TenantData; onNavigate: (v: ViewId) => void }) {
  const since30 = data.now - 30 * 86_400_000;
  const live = data.agents.filter((a) => a.status === "live").length;
  const pending = data.approvals.filter((a) => a.status === "pending");
  const waiting = data.conversations.filter((c) => c.status === "waiting_human");
  const outcomes30 = data.outcomes.filter((o) => new Date(o.createdAt).getTime() >= since30);
  const value30 = outcomes30.reduce((s, o) => s + o.value, 0);
  const leads30 = outcomes30.filter((o) => o.kind === "lead").length;
  const spendMonth = data.usage.filter((u) => u.createdAt >= data.monthStart).reduce((s, u) => s + u.costUsd, 0);
  const convs7 = data.conversations.filter((c) => new Date(c.createdAt).getTime() >= data.now - 7 * 86_400_000).length;

  // Outcome value per day for the last 14 days, drawn as bars.
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(data.now - (13 - i) * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const dayOutcomes = data.outcomes.filter((o) => o.createdAt.slice(0, 10) === key);
    return { key, label: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }), count: dayOutcomes.length, value: dayOutcomes.reduce((s, o) => s + o.value, 0) };
  });
  const maxCount = Math.max(1, ...days.map((d) => d.count));

  const alerts: { text: string; view: ViewId }[] = [];
  if (pending.length) alerts.push({ text: `${pending.length} request(s) waiting for your approval`, view: "approvals" });
  if (waiting.length) alerts.push({ text: `${waiting.length} conversation(s) handed to a person`, view: "conversations" });
  for (const a of data.agents) {
    const spent = data.usage.filter((u) => u.agentId === a.id && u.createdAt >= data.monthStart).reduce((s, u) => s + u.costUsd, 0);
    if (a.monthlyBudgetUsd > 0 && spent >= a.monthlyBudgetUsd * 0.8) alerts.push({ text: `${a.name} has used ${Math.round((spent / a.monthlyBudgetUsd) * 100)}% of this month's budget`, view: "agents" });
  }
  for (const m of data.team.filter((t) => t.health === "down")) alerts.push({ text: `${m.name} is down: ${m.reason}`, view: "agents" });
  if (!data.settings.find((s) => s.key === "ANTHROPIC_API_KEY")?.configured) alerts.push({ text: "No Anthropic API key yet, so agents answer in demo mode", view: "settings" });
  if (!data.settings.find((s) => s.key === "N8N_WEBHOOK_URL")?.configured) alerts.push({ text: "n8n isn't connected, so workflows and WhatsApp replies won't run", view: "settings" });

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={Bot} label="Live agents" value={`${live} / ${data.agents.length}`} />
        <MetricCard icon={Inbox} label="Conversations (7d)" value={convs7} />
        <MetricCard icon={ClipboardCheck} label="Awaiting approval" value={pending.length} accent />
        <MetricCard icon={TrendingUp} label="Outcome value (30d)" value={money(value30, data.tenant.currency)} hint={`${leads30} leads captured`} />
        <MetricCard icon={Coins} label="AI spend this month" value={usd(spendMonth)} accent />
      </div>

      {data.team.some((t) => t.health !== "off") && (
        <div>
          <SectionTitle icon={Bot}>AI team right now</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.team
              .filter((t) => t.health !== "off")
              .map((t) => (
                <button key={t.id} onClick={() => onNavigate("agents")} className={`${cardClass} flex items-start gap-3 px-4 py-3 text-left transition hover:border-lagoon`}>
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${HEALTH_DOT[t.health]}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{t.name} <span className="font-normal text-slate/55">· {t.title ?? t.roleName}</span></span>
                    <span className="block text-xs text-slate/60">
                      {HEALTH_LABEL[t.health]}: {t.reason}
                      {t.lastActiveAt ? `, last active ${timeAgo(t.lastActiveAt)}` : ""}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionTitle icon={TrendingUp}>Outcomes, last 14 days</SectionTitle>
          <div className={`${cardClass} p-5`}>
            <div className="flex h-40 items-end gap-1.5">
              {days.map((d) => (
                <div key={d.key} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div
                    className="rounded-t-md bg-lagoon/80 transition group-hover:bg-lagoon"
                    style={{ height: `${(d.count / maxCount) * 100}%`, minHeight: d.count ? 4 : 0 }}
                    title={`${d.label}: ${d.count} outcome(s), ${money(d.value, data.tenant.currency)}`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-slate/45">
              <span>{days[0].label}</span>
              <span>{days[13].label}</span>
            </div>
          </div>
        </div>

        <div>
          <SectionTitle icon={AlertTriangle}>Needs attention</SectionTitle>
          <div className="flex flex-col gap-2">
            {alerts.length === 0 && <Card><p className="text-sm text-slate/60">All clear. Nothing needs you right now.</p></Card>}
            {alerts.map((a) => (
              <button key={a.text} onClick={() => onNavigate(a.view)} className={`${cardClass} flex items-start gap-3 px-4 py-3 text-left text-sm text-ink transition hover:border-amber`}>
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber" />
                {a.text}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle icon={Bot}>Your AI staff</SectionTitle>
          <div className="flex flex-col gap-2">
            {data.agents.map((a) => {
              const role = data.roles.find((r) => r.key === a.templateKey);
              return (
                <div key={a.id} className={`${cardClass} flex items-center gap-3 px-4 py-3`}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lagoon/15 font-heading text-sm font-bold text-lagoon">{a.name.slice(0, 1)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink">{a.name}</div>
                    <div className="truncate text-xs text-slate/55">{a.title ?? role?.name} · {a.channels.filter((c) => c !== "playground").join(", ") || "playground only"}</div>
                  </div>
                  <Pill status={a.status} />
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <SectionTitle icon={ScrollText}>Recent activity</SectionTitle>
          <div className={`${cardClass} divide-y divide-ink/5`}>
            {data.audit.slice(0, 8).map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-ink">{e.actor}</span> <span className="text-slate/60">{e.action}</span>
                </span>
                <span className="shrink-0 text-xs text-slate/45">{timeAgo(e.createdAt)}</span>
              </div>
            ))}
            {data.audit.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate/45">No activity yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
