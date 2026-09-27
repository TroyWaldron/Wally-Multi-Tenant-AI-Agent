"use client";

import { useState } from "react";
import { Bot, MessageSquareText, Plus, ShieldCheck, SlidersHorizontal, Trash2, X } from "lucide-react";
import { deleteAgent, hireAgent, saveAgent } from "@/app/console/actions";
import type { Agent, Personality } from "@/lib/types";
import type { TenantData } from "../Console";
import { OrgChart } from "../OrgChart";
import { Button, Card, cardClass, Empty, Field, inputClass, Pill, SectionTitle, useAction, usd } from "../ui";

const CHANNELS = [
  { id: "web", label: "Website widget" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
  { id: "slack", label: "Slack / Teams" },
  { id: "phone", label: "Phone (phase 3)" },
  { id: "ops", label: "Back office (never talks to customers)" },
];

const SLIDERS: { key: keyof Personality; label: string; low: string; high: string }[] = [
  { key: "warmth", label: "Warmth", low: "Reserved", high: "Very warm" },
  { key: "humor", label: "Humour", low: "Serious", high: "Playful" },
  { key: "formality", label: "Formality", low: "Casual", high: "Formal" },
  { key: "directness", label: "Directness", low: "Gentle", high: "Straight to it" },
  { key: "voicePace", label: "Voice pace", low: "Slow", high: "Quick" },
];

export function AgentsView({ data, onTest }: { data: TenantData; onTest: (id: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [hiring, setHiring] = useState(false);
  const { run, pending } = useAction();
  const agent = data.agents.find((a) => a.id === editing);

  const spentBy = (id: string) => data.usage.filter((u) => u.agentId === id && u.createdAt >= data.monthStart).reduce((s, u) => s + u.costUsd, 0);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        icon={Bot}
        action={
          <Button variant="accent" onClick={() => setHiring((v) => !v)}>
            <Plus className="h-4 w-4" /> Hire an agent
          </Button>
        }
      >
        {data.agents.length} agent{data.agents.length === 1 ? "" : "s"} at {data.tenant.name}
      </SectionTitle>

      {hiring && (
        <Card title="Pick a role. The new agent starts as a draft you can test before going live.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.roles.map((r) => (
              <button
                key={r.key}
                disabled={pending}
                onClick={() => run(() => hireAgent(data.tenant.id, r.key), (res) => { setHiring(false); setEditing(String(res.data)); })}
                className="rounded-xl border border-ink/10 p-3 text-left transition hover:border-lagoon hover:bg-lagoon/5"
              >
                <div className="text-sm font-semibold text-ink">{r.name}</div>
                <div className="mt-0.5 text-xs text-slate/60">{r.summary}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {data.agents.length > 0 && (
        <OrgChart
          team={data.team}
          businessName={data.tenant.name}
          onOpen={(id) => setEditing(id)}
          onTest={onTest}
          onHire={() => setHiring(true)}
        />
      )}

      {data.agents.length === 0 && !hiring && (
        <Empty title="No agents yet" action={<Button variant="accent" onClick={() => setHiring(true)}>Hire your first agent</Button>}>
          Start with a receptionist: it answers the website and WhatsApp from your knowledge base and hands anything tricky to you.
        </Empty>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.agents.map((a) => {
          const spent = spentBy(a.id);
          const pct = a.monthlyBudgetUsd > 0 ? Math.min(100, (spent / a.monthlyBudgetUsd) * 100) : 0;
          const role = data.roles.find((r) => r.key === a.templateKey);
          const model = data.models.find((m) => m.id === a.model);
          return (
            <div key={a.id} className={`${cardClass} flex flex-col gap-4 p-5 ${editing === a.id ? "ring-2 ring-lagoon" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lagoon/15 font-heading text-lg font-bold text-lagoon">{a.name.slice(0, 1)}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-heading text-base font-semibold text-ink">{a.name}</div>
                  <div className="text-xs text-slate/55">{a.title ?? role?.name} · {role?.name}</div>
                </div>
                <Pill status={a.status} />
              </div>
              <dl className="grid grid-cols-2 gap-y-2 text-xs">
                <dt className="text-slate/50">Model</dt>
                <dd className="text-right font-medium text-ink">{model?.label ?? a.model}</dd>
                <dt className="text-slate/50">Channels</dt>
                <dd className="truncate text-right font-medium text-ink">{a.channels.filter((c) => c !== "playground").join(", ") || "Playground only"}</dd>
                <dt className="text-slate/50">Needs approval for</dt>
                <dd className="text-right font-medium text-ink">{a.boundaries.approvalRequired.length} actions</dd>
              </dl>
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-slate/55">
                  <span>Budget this month</span>
                  <span className="tabular-nums">{usd(spent)} / {usd(a.monthlyBudgetUsd)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink/8">
                  <div className={`h-full rounded-full ${pct >= 80 ? "bg-coral" : "bg-lagoon"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="mt-auto flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(a.id)}>
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Configure
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onTest(a.id)}>
                  <MessageSquareText className="h-3.5 w-3.5" /> Test
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {agent && <AgentEditor key={agent.id} agent={agent} data={data} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ChipList({ values, onChange, placeholder, id }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; id: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-ink/6 px-2.5 py-1 text-xs text-ink">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="text-ink/40 hover:text-coral">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-slate/45">None</span>}
      </div>
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className={inputClass}
        />
        <Button type="button" size="sm" variant="secondary" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

function AgentEditor({ agent, data, onClose }: { agent: Agent; data: TenantData; onClose: () => void }) {
  const [a, setA] = useState<Agent>(agent);
  const { run, pending } = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => setA((x) => ({ ...x, [k]: v }));
  const setB = <K extends keyof Agent["boundaries"]>(k: K, v: Agent["boundaries"][K]) => setA((x) => ({ ...x, boundaries: { ...x.boundaries, [k]: v } }));
  const role = data.roles.find((r) => r.key === a.templateKey);
  const model = data.models.find((m) => m.id === a.model);

  const save = () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { createdAt, updatedAt, tenantId, ...rest } = a;
    run(() => saveAgent(data.tenant.id, rest));
  };

  return (
    <div className={`${cardClass} p-6`}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-ink">Configure {agent.name}</h2>
          <p className="text-sm text-slate/60">Based on the {role?.name} role. Changes apply to the next message.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="accent" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-lagoon">Identity</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="ag-name"><input id="ag-name" className={inputClass} value={a.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Job title" htmlFor="ag-title"><input id="ag-title" className={inputClass} value={a.title ?? ""} onChange={(e) => set("title", e.target.value)} /></Field>
          </div>
          <Field label="Status" hint="Draft agents only answer in the Playground. Paused agents hand every message to your team.">
            <div className="flex gap-2">
              {(["draft", "live", "paused"] as const).map((s) => (
                <button key={s} type="button" onClick={() => set("status", s)} className={`rounded-full border px-4 py-1.5 text-xs font-semibold capitalize transition ${a.status === s ? "border-ink bg-ink text-white" : "border-ink/15 text-ink hover:border-ink/40"}`}>
                  {s}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Channels">
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((c) => {
                const on = a.channels.includes(c.id);
                return (
                  <label key={c.id} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${on ? "border-lagoon bg-lagoon/10 text-lagoon-deep" : "border-ink/15 text-ink/70"}`}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => set("channels", on ? a.channels.filter((x) => x !== c.id) : [...a.channels, c.id])} />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </Field>
          <Field label="Instructions from you" hint="House rules, tone notes, anything specific to this business." htmlFor="ag-instr">
            <textarea id="ag-instr" rows={5} className={inputClass} value={a.instructions} onChange={(e) => set("instructions", e.target.value)} />
          </Field>

          <h3 className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-lagoon">Personality</h3>
          <div className="flex flex-col gap-3">
            {SLIDERS.map((s) => (
              <div key={s.key}>
                <div className="mb-1 flex justify-between text-xs">
                  <label htmlFor={`p-${s.key}`} className="font-semibold text-ink/80">{s.label}</label>
                  <span className="tabular-nums text-slate/50">{a.personality[s.key]}</span>
                </div>
                <input id={`p-${s.key}`} type="range" min={0} max={100} value={a.personality[s.key]} onChange={(e) => set("personality", { ...a.personality, [s.key]: Number(e.target.value) })} className="w-full" />
                <div className="flex justify-between text-[10px] text-slate/45"><span>{s.low}</span><span>{s.high}</span></div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-lagoon"><ShieldCheck className="h-3.5 w-3.5" /> Decision boundaries</h3>
          <Field label="Needs your approval before doing" hint="The agent sends these to the Approvals inbox instead of acting.">
            <ChipList id="ag-approval" values={a.boundaries.approvalRequired} onChange={(v) => setB("approvalRequired", v)} placeholder="e.g. refund" />
          </Field>
          <Field label="Workflows it can run in n8n" hint="Names must match the workflow switch in your n8n router.">
            <ChipList id="ag-wf" values={a.boundaries.workflows} onChange={(v) => setB("workflows", v)} placeholder="e.g. check_availability" />
          </Field>
          <Field label="Never does" hint="Plain-language limits, written into its instructions.">
            <ChipList id="ag-cannot" values={a.boundaries.cannot} onChange={(v) => setB("cannot", v)} placeholder="e.g. Promise refunds" />
          </Field>
          <Field label="Working hours" htmlFor="ag-hours"><input id="ag-hours" className={inputClass} value={a.boundaries.hours ?? ""} onChange={(e) => setB("hours", e.target.value)} placeholder="24/7" /></Field>

          <h3 className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-lagoon">Model & cost</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Model" htmlFor="ag-model" hint={model?.note}>
              <select id="ag-model" className={inputClass} value={a.model} onChange={(e) => set("model", e.target.value)}>
                {data.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Fallback model" htmlFor="ag-fallback" hint="Used if the main model is down.">
              <select id="ag-fallback" className={inputClass} value={a.fallbackModel ?? ""} onChange={(e) => set("fallbackModel", e.target.value || null)}>
                {data.models.filter((m) => m.provider === "anthropic").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Thinking effort" htmlFor="ag-effort" hint="Higher is more careful, slower and costs more.">
              <select id="ag-effort" className={inputClass} value={a.effort} onChange={(e) => set("effort", e.target.value as Agent["effort"])} disabled={!model?.supportsEffort}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
            <Field label="Monthly budget (US$)" htmlFor="ag-budget" hint="The agent pauses and hands over when it's reached.">
              <input id="ag-budget" type="number" min={0} step={5} className={inputClass} value={a.monthlyBudgetUsd} onChange={(e) => set("monthlyBudgetUsd", Number(e.target.value))} />
            </Field>
          </div>

          <div className="mt-4 rounded-xl border border-coral/20 bg-coral/5 p-4">
            {confirmDelete ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-ink">Remove {agent.name}? Its conversations stay in the log.</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
                  <Button size="sm" variant="danger" onClick={() => run(() => deleteAgent(data.tenant.id, agent.id), onClose)}>Remove</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 className="h-3.5 w-3.5" /> Remove agent</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
