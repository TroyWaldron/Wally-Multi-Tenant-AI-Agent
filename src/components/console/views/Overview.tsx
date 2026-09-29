"use client";

import { Bot, Building2, LifeBuoy, MessagesSquare } from "lucide-react";
import type { BusinessSummary } from "../Console";
import { Card, MetricCard, money, Pill, Table } from "../ui";

/**
 * Wally's own home: every business Wally seconds AI staff to, at a glance.
 * Day-to-day work (guest chats, approvals) belongs to each business's own
 * team in its back office, so this shows it only as a count; what needs
 * Wally is the helpdesk.
 */
export function OverviewView({ businesses }: { businesses: BusinessSummary[] }) {
  const sum = (k: keyof BusinessSummary) => businesses.reduce((n, b) => n + (b[k] as number), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Building2} label="Businesses" value={businesses.length} hint={`${businesses.filter((b) => b.status === "active").length} active`} />
        <MetricCard icon={Bot} label="AI staff live" value={sum("aiStaffLive")} />
        <MetricCard icon={MessagesSquare} label="Chats this month" value={sum("chatsThisMonth")} />
        <MetricCard icon={LifeBuoy} label="Helpdesk open" value={sum("helpdeskOpen")} hint="Businesses asking Wally for help" accent={sum("helpdeskOpen") > 0} />
      </div>

      <Card title="Businesses">
        <Table
          minWidth={760}
          columns={["Business", "Status", "AI staff", "Chats this month", "With their team", "Helpdesk", "Price / month"]}
          empty="No businesses yet. Add one from Business."
          rows={businesses.map((b) => [
            <div key="n">
              <a href={`/console?t=${b.slug}`} className="font-semibold text-ink hover:text-lagoon">{b.name}</a>
              {b.agency && <div className="text-xs text-slate/55">via {b.agency}</div>}
            </div>,
            <Pill key="s" status={b.status} />,
            <span key="a" className="tabular-nums">{b.aiStaffLive}</span>,
            <span key="c" className="tabular-nums">{b.chatsThisMonth}</span>,
            <span key="w" className="text-xs text-slate/65 tabular-nums">
              {b.waitingForPerson + b.pendingApprovals ? `${b.waitingForPerson} chats, ${b.pendingApprovals} approvals` : "Nothing waiting"}
            </span>,
            <span key="h" className={`tabular-nums ${b.helpdeskOpen ? "font-semibold text-coral" : ""}`}>{b.helpdeskOpen}</span>,
            <span key="p" className="tabular-nums">{b.monthlyPrice ? money(b.monthlyPrice, b.currency) : "No agreement"}</span>,
          ])}
        />
        <p className="mt-3 text-xs text-slate/55">
          &ldquo;With their team&rdquo; is work each business handles in its own back office. Wally only steps in on helpdesk tickets.
        </p>
      </Card>
    </div>
  );
}
