"use client";

import { useState } from "react";
import type { TenantData } from "../Console";
import { inputClass, Pill, Table } from "../ui";

export function AuditView({ data }: { data: TenantData }) {
  const [q, setQ] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const flagged = data.audit.filter((e) => e.action === "hub.flagged").length;
  const rows = data.audit
    .filter((e) => !flaggedOnly || e.action === "hub.flagged")
    .filter((e) => !q || `${e.actor} ${e.action} ${JSON.stringify(e.detail)}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate/65">Every agent action, tool call, approval and setting change, newest first, plus what the business's back office reports (hub.*). The log is append-only in the database: nobody, including admins, can edit or delete an entry.</p>
        {flagged > 0 && (
          <button type="button" onClick={() => setFlaggedOnly((f) => !f)} className={`rounded-full px-3 py-1 text-xs font-semibold ${flaggedOnly ? "bg-coral text-white" : "border border-coral/40 text-coral"}`}>
            {flagged} flagged
          </button>
        )}
        <input id="audit-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${inputClass} max-w-xs`} />
      </div>
      <Table
        minWidth={760}
        columns={["When", "Who", "Action", "Detail"]}
        empty="No entries."
        rows={rows.map((e) => [
          <span key="w" className="whitespace-nowrap text-xs tabular-nums">{new Date(e.createdAt).toLocaleString()}</span>,
          <span key="a" className="flex items-center gap-2"><Pill status={e.actorType === "agent" ? "open" : e.actorType === "user" ? "live" : "draft"} label={e.actorType} />{e.actor}</span>,
          <code key="c" className={`font-mono text-xs ${e.action === "hub.flagged" ? "font-semibold text-coral" : "text-ink"}`}>{e.action}</code>,
          <code key="d" className="line-clamp-2 max-w-md break-all font-mono text-[11px] text-slate/60">{JSON.stringify(e.detail)}</code>,
        ])}
      />
    </div>
  );
}
