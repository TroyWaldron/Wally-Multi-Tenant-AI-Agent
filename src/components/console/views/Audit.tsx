"use client";

import { useState } from "react";
import type { TenantData } from "../Console";
import { inputClass, Pill, Table } from "../ui";

export function AuditView({ data }: { data: TenantData }) {
  const [q, setQ] = useState("");
  const rows = data.audit.filter((e) => !q || `${e.actor} ${e.action} ${JSON.stringify(e.detail)}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate/65">Every agent action, tool call, approval and setting change, newest first. The log is append-only in the database: nobody, including admins, can edit or delete an entry.</p>
        <input id="audit-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className={`${inputClass} max-w-xs`} />
      </div>
      <Table
        minWidth={760}
        columns={["When", "Who", "Action", "Detail"]}
        empty="No entries."
        rows={rows.map((e) => [
          <span key="w" className="whitespace-nowrap text-xs tabular-nums">{new Date(e.createdAt).toLocaleString()}</span>,
          <span key="a" className="flex items-center gap-2"><Pill status={e.actorType === "agent" ? "open" : e.actorType === "user" ? "live" : "draft"} label={e.actorType} />{e.actor}</span>,
          <code key="c" className="font-mono text-xs text-ink">{e.action}</code>,
          <code key="d" className="line-clamp-2 max-w-md break-all font-mono text-[11px] text-slate/60">{JSON.stringify(e.detail)}</code>,
        ])}
      />
    </div>
  );
}
