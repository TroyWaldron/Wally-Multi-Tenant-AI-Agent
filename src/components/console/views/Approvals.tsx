"use client";

import { useState } from "react";
import { Check, ClipboardCheck, GraduationCap, History, X } from "lucide-react";
import { decideApproval } from "@/app/console/actions";
import { editableOf } from "@/lib/draftText";
import type { TenantData } from "../Console";
import { Button, cardClass, Empty, inputClass, Pill, SectionTitle, Table, timeAgo, useAction } from "../ui";

export function ApprovalsView({ data }: { data: TenantData }) {
  const { run, pending } = useAction();
  const [declining, setDeclining] = useState<string | null>(null);
  const [lesson, setLesson] = useState("");
  // Wording changes to drafts and emails, by approval id.
  const [edits, setEdits] = useState<Record<string, { subject?: string; body?: string }>>({});
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
                {editableOf(a) ? (
                  <DraftEditor
                    id={a.id}
                    original={editableOf(a)!}
                    to={String((a.payload.draft as { toName?: string; to?: string } | undefined)?.toName || (a.payload.draft as { to?: string } | undefined)?.to || ((a.payload.email as { to?: string[] } | undefined)?.to ?? []).join(", "))}
                    value={edits[a.id]}
                    onChange={(v) => setEdits((x) => ({ ...x, [a.id]: v }))}
                  />
                ) : Object.keys(a.payload).length > 0 && (
                  <pre className="overflow-x-auto rounded-lg bg-paper px-3 py-2 font-mono text-[11px] text-slate/70">{JSON.stringify(a.payload, null, 2)}</pre>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="accent" disabled={pending} onClick={() => run(() => decideApproval(data.tenant.id, a.id, "approved", undefined, edits[a.id]))}>
                    <Check className="h-3.5 w-3.5" /> {a.kind === "escalation" ? "I'll take it" : editableOf(a) ? "Approve and send" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      a.kind === "escalation" || !a.agentId
                        ? run(() => decideApproval(data.tenant.id, a.id, "rejected"))
                        : (setDeclining(declining === a.id ? null : a.id), setLesson(""))
                    }
                  >
                    <X className="h-3.5 w-3.5" /> {a.kind === "escalation" ? "Dismiss" : "Decline"}
                  </Button>
                </div>
                {declining === a.id && (
                  <form
                    className="flex flex-col gap-2 rounded-xl bg-paper p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => decideApproval(data.tenant.id, a.id, "rejected", lesson), () => setDeclining(null));
                    }}
                  >
                    <label htmlFor={`lesson-${a.id}`} className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                      <GraduationCap className="h-3.5 w-3.5 text-lagoon" /> Teach {agentName(a.agentId)} (optional)
                    </label>
                    <input
                      id={`lesson-${a.id}`}
                      className={inputClass}
                      value={lesson}
                      onChange={(e) => setLesson(e.target.value)}
                      placeholder="e.g. Never offer more than 10% off"
                    />
                    <p className="text-[11px] text-slate/55">Anything you write becomes a standing rule for the agent, so it stops asking for the same thing. Leave it blank to just decline.</p>
                    <div>
                      <Button size="sm" variant="secondary" disabled={pending}>Decline</Button>
                    </div>
                  </form>
                )}
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

function DraftEditor({ id, original, to, value, onChange }: { id: string; original: { subject?: string; body: string }; to: string; value?: { subject?: string; body?: string }; onChange: (v: { subject?: string; body?: string }) => void }) {
  const v = { subject: value?.subject ?? original.subject, body: value?.body ?? original.body };
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-paper p-3">
      {to && <div className="text-xs text-slate/60">To: <span className="font-semibold text-ink">{to}</span></div>}
      {original.subject !== undefined && (
        <input aria-label="Subject" className={inputClass} value={v.subject ?? ""} onChange={(e) => onChange({ ...v, subject: e.target.value })} />
      )}
      <textarea id={`draft-${id}`} aria-label="Message" rows={Math.min(14, Math.max(4, v.body.split("\n").length + 1))} className={inputClass} value={v.body} onChange={(e) => onChange({ ...v, body: e.target.value })} />
      <p className="text-[11px] text-slate/55">Change anything you like; what you approve is what goes out.</p>
    </div>
  );
}
