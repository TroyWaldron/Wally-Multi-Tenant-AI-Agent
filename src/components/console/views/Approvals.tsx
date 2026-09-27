"use client";

import { Check, ClipboardCheck, History, X } from "lucide-react";
import { decideApproval } from "@/app/console/actions";
import type { TenantData } from "../Console";
import { Button, cardClass, Empty, Pill, SectionTitle, Table, timeAgo, useAction } from "../ui";

export function ApprovalsView({ data }: { data: TenantData }) {
  const { run, pending } = useAction();
  const open = data.approvals.filter((a) => a.status === "pending");
  const done = data.approvals.filter((a) => a.status !== "pending");
  const agentName = (id: string | null) => data.agents.find((a) => a.id === id)?.name ?? "n8n / system";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <SectionTitle icon={ClipboardCheck}>Waiting for you</SectionTitle>
        {open.length === 0 ? (
          <Empty title="Nothing to approve">When an agent needs a yes or no (a discount, a refund, an invoice to send), it shows up here, and on WhatsApp or email if n8n forwards it.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {open.map((a) => (
              <div key={a.id} className={`${cardClass} flex flex-col gap-3 border-l-4 p-5 ${a.kind === "escalation" ? "border-l-coral" : "border-l-amber"}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate/55">
                  <Pill status={a.kind === "escalation" ? "error" : "pending"} label={a.kind === "escalation" ? "handover" : a.action} />
                  <span>from {agentName(a.agentId)}</span>
                  <span>·</span>
                  <span>{timeAgo(a.createdAt)}</span>
                </div>
                <p className="text-sm font-medium text-ink">{a.summary}</p>
                {Object.keys(a.payload).length > 0 && (
                  <pre className="overflow-x-auto rounded-lg bg-paper px-3 py-2 font-mono text-[11px] text-slate/70">{JSON.stringify(a.payload, null, 2)}</pre>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="accent" disabled={pending} onClick={() => run(() => decideApproval(data.tenant.id, a.id, "approved"))}>
                    <Check className="h-3.5 w-3.5" /> {a.kind === "escalation" ? "I'll take it" : "Approve"}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => decideApproval(data.tenant.id, a.id, "rejected"))}>
                    <X className="h-3.5 w-3.5" /> {a.kind === "escalation" ? "Dismiss" : "Decline"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionTitle icon={History}>Decided</SectionTitle>
        <Table
          columns={["Request", "Agent", "Decision", "By", "When"]}
          empty="No decisions yet."
          rows={done.map((a) => [
            <span key="s" className="line-clamp-2 max-w-md">{a.summary}</span>,
            agentName(a.agentId),
            <Pill key="p" status={a.status} />,
            a.decidedBy ?? "",
            a.decidedAt ? timeAgo(a.decidedAt) : "",
          ])}
        />
      </div>
    </div>
  );
}
