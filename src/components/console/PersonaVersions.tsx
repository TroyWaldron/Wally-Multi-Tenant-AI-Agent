"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { loadVersions, restoreVersion, startExperiment, stopExperiment, type VersionsView } from "@/app/console/actions";
import { Button, timeAgo, useAction } from "./ui";

/**
 * Every saved persona of an agent, with restore, and an A/B test that sends
 * a share of new chats to an older version and compares the results.
 */
export function PersonaVersions({ tenantId, agentId, onChanged }: { tenantId: string; agentId: string; onChanged: () => void }) {
  const { run, pending } = useAction();
  const [view, setView] = useState<VersionsView | null>(null);
  const [share, setShare] = useState(50);
  const reload = () => run(() => loadVersions(tenantId, agentId), (r) => setView(r.data as VersionsView));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [tenantId, agentId]);

  if (!view) return <p className="text-xs text-slate/55">Loading versions…</p>;
  const exp = view.experiment;
  const rate = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

  return (
    <div className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-lagoon"><History className="h-3.5 w-3.5" /> Persona versions</h3>
      {exp && (
        <div className="rounded-xl border border-lagoon/30 bg-lagoon/5 p-3 text-xs">
          <p className="font-semibold text-ink">A/B test running since {timeAgo(exp.startedAt)}: {exp.share}% of new chats get the older version (B).</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left tabular-nums">
              <thead><tr className="text-slate/55"><th className="py-1 pr-3 font-semibold" /><th className="py-1 pr-3 font-semibold">Chats</th><th className="py-1 pr-3 font-semibold">Handed to a person</th><th className="py-1 pr-3 font-semibold">Leads</th></tr></thead>
              <tbody>
                {(["A", "B"] as const).map((v) => (
                  <tr key={v} className="border-t border-ink/5">
                    <td className="py-1 pr-3 font-semibold text-ink">{v === "A" ? "A (current)" : "B (older)"}</td>
                    <td className="py-1 pr-3">{exp.results[v].chats}</td>
                    <td className="py-1 pr-3">{rate(exp.results[v].handedOver, exp.results[v].chats)}</td>
                    <td className="py-1 pr-3">{rate(exp.results[v].leads, exp.results[v].chats)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => stopExperiment(tenantId, agentId, "A"), onChanged)}>Keep A</Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => stopExperiment(tenantId, agentId, "B"), onChanged)}>Switch to B</Button>
          </div>
        </div>
      )}
      {view.versions.length === 0 ? (
        <p className="text-xs text-slate/55">Versions are kept each time you save a change to the title, instructions or tone.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-ink/5 rounded-xl border border-ink/10">
          {view.versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{v.current ? "Current" : timeAgo(v.createdAt)}{v.createdBy ? <span className="font-normal text-slate/55"> · {v.createdBy}</span> : null}</p>
                {v.note && <p className="text-slate/60">{v.note}</p>}
                <p className="mt-0.5 line-clamp-2 text-slate/55">{v.instructions}</p>
              </div>
              {!v.current && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => restoreVersion(tenantId, agentId, v.id), onChanged)}>Restore</Button>
                  {!exp && <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => startExperiment(tenantId, agentId, v.id, share), reload)}>A/B test</Button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!exp && view.versions.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-slate/60">
          A/B tests send
          <select value={share} onChange={(e) => setShare(Number(e.target.value))} className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-ink">
            {[10, 25, 50].map((n) => <option key={n} value={n}>{n}%</option>)}
          </select>
          of new chats to the older version.
        </label>
      )}
    </div>
  );
}
