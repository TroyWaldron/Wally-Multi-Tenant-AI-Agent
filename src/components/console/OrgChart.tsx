"use client";

import { useState } from "react";
import { Briefcase, MessageSquareText, Pencil, Plus, Users } from "lucide-react";
import { PRICE_TIERS } from "@/lib/billing";
import { HEALTH_LABEL, type Health, type TeamMember } from "@/lib/team";
import { Button, cardClass, timeAgo } from "./ui";

export const HEALTH_DOT: Record<Health, string> = {
  up: "bg-leaf",
  down: "bg-coral",
  waiting: "bg-amber",
  paused: "bg-slate/40",
  off: "bg-slate/20",
};

const CHANNEL_LABEL: Record<string, string> = { web: "Website", whatsapp: "WhatsApp", email: "Email", slack: "Slack", phone: "Phone", ops: "Back office" };
const human = (s: string) => s.replace(/_/g, " ");

function Node({ m, selected, onClick }: { m: TeamMember; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-44 rounded-xl border bg-white p-3 text-left transition hover:border-lagoon ${
        m.health === "off" ? "border-dashed border-ink/20" : "border-ink/10"
      } ${selected ? "ring-2 ring-lagoon" : ""}`}
    >
      <span className={`absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full ${HEALTH_DOT[m.health]}`} title={HEALTH_LABEL[m.health]} />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lagoon/15 font-heading text-sm font-bold text-lagoon">{m.name.slice(0, 1)}</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{m.name}</div>
          <div className="truncate text-[11px] text-slate/60">{m.title ?? m.roleName}</div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-slate/55">{m.kind === "front" ? "Talks to customers" : "Works for the team"}</div>
    </button>
  );
}

function Branch({ members, parent, selected, onSelect }: { members: TeamMember[]; parent: string | null; selected: string | null; onSelect: (id: string) => void }) {
  const kids = members.filter((m) => m.health !== "off" && m.reportsTo === parent);
  if (!kids.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-4 pt-4">
      {kids.map((m) => (
        <div key={m.id} className="flex flex-col items-center">
          <div className="h-4 w-px bg-ink/15" />
          <Node m={m} selected={selected === m.id} onClick={() => onSelect(m.id)} />
          <Branch members={members} parent={m.id} selected={selected} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}

/**
 * The AI team as an org chart: the business's people at the top, AI staff
 * below by seniority. Click anyone to see what they do, what needs your
 * approval and whether they are working; drafts wait at the bottom, ready
 * to deploy.
 */
export function OrgChart({
  team,
  businessName,
  onOpen,
  onTest,
  onHire,
}: {
  team: TeamMember[];
  businessName: string;
  onOpen: (id: string) => void;
  onTest: (id: string) => void;
  onHire: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const m = team.find((t) => t.id === selected);
  const drafts = team.filter((t) => t.health === "off");
  const boss = m?.reportsTo ? team.find((t) => t.id === m.reportsTo)?.name : null;
  const tier = m ? PRICE_TIERS.find((p) => p.key === m.tier) : null;

  return (
    <div className={`${cardClass} grid gap-6 p-5 lg:grid-cols-[1fr_18rem]`}>
      <div className="overflow-x-auto">
        <div className="flex min-w-max flex-col items-center">
          <div className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-white">
            <Users className="h-4 w-4" />
            <div>
              <div className="text-sm font-semibold">{businessName} team</div>
              <div className="text-[11px] text-white/60">Owner and managers (people)</div>
            </div>
          </div>
          <Branch members={team} parent={null} selected={selected} onSelect={setSelected} />
          <button type="button" onClick={onHire} className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink/25 px-3 py-1.5 text-xs font-semibold text-slate/70 hover:border-lagoon hover:text-lagoon">
            <Plus className="h-3.5 w-3.5" /> Hire AI staff
          </button>
        </div>
        {drafts.length > 0 && (
          <div className="mt-6 border-t border-ink/8 pt-4">
            <div className="mb-2 text-xs font-semibold text-slate/60">Not deployed yet</div>
            <div className="flex flex-wrap gap-3">
              {drafts.map((d) => (
                <Node key={d.id} m={d} selected={selected === d.id} onClick={() => setSelected(d.id)} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-paper p-4 text-sm">
        {!m ? (
          <div className="text-slate/60">
            <Briefcase className="mb-2 h-5 w-5 text-lagoon" />
            Click anyone on the chart to see their job, who they report to, what they hand to you and whether they are working.
            <div className="mt-4 space-y-1.5 text-xs">
              {(Object.keys(HEALTH_LABEL) as Health[]).map((h) => (
                <div key={h} className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${HEALTH_DOT[h]}`} />{HEALTH_LABEL[h]}</div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="font-heading text-lg font-bold text-ink">{m.name}</div>
              <div className="text-xs text-slate/60">{m.title ?? m.roleName} · {m.roleName} role{tier ? ` · ${tier.name} tier` : ""}</div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={`h-2.5 w-2.5 rounded-full ${HEALTH_DOT[m.health]}`} />
              <span className="font-semibold text-ink">{HEALTH_LABEL[m.health]}</span>
              <span className="text-slate/60">{m.reason}{m.lastActiveAt ? `, last active ${timeAgo(m.lastActiveAt)}` : ""}</span>
            </div>
            <p className="text-xs text-slate/75">{m.summary}</p>
            <div className="text-xs">
              <div className="font-semibold text-ink">Reports to</div>
              <div className="text-slate/70">{boss ?? "The business's own people"}</div>
            </div>
            {m.channels.length > 0 && (
              <div className="text-xs">
                <div className="font-semibold text-ink">Works on</div>
                <div className="text-slate/70">{m.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ")}</div>
              </div>
            )}
            {m.workflows.length > 0 && (
              <div className="text-xs">
                <div className="font-semibold text-ink">Workflows</div>
                <div className="text-slate/70">{m.workflows.map(human).join(", ")}</div>
              </div>
            )}
            {m.needsApproval.length > 0 && (
              <div className="text-xs">
                <div className="font-semibold text-ink">Asks you before</div>
                <div className="text-slate/70">{m.needsApproval.map(human).join(", ")}</div>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" onClick={() => onOpen(m.id)}><Pencil className="h-3.5 w-3.5" /> {m.health === "off" ? "Set up and deploy" : "Open"}</Button>
              <Button variant="ghost" onClick={() => onTest(m.id)}><MessageSquareText className="h-3.5 w-3.5" /> Test</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
