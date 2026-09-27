"use client";

import { useState } from "react";
import { Code2, Plug, Trash2, Webhook } from "lucide-react";
import { deleteChannel, saveChannel } from "@/app/console/actions";
import type { Channel } from "@/lib/types";
import type { TenantData } from "../Console";
import { Button, Card, Field, inputClass, Pill, SectionTitle, Table, useAction } from "../ui";
import { CopyBox } from "./CopyBox";

const KINDS: { id: Channel["kind"]; label: string; hint: string }[] = [
  { id: "whatsapp", label: "WhatsApp", hint: "The phone_number_id from Meta's WhatsApp Manager (not the phone number itself)." },
  { id: "web", label: "Website", hint: "The site's domain, for your records. The widget itself uses the key below." },
  { id: "email", label: "Email inbox", hint: "The address n8n reads, e.g. reservations@…" },
  { id: "slack", label: "Slack / Teams", hint: "Workspace or team ID." },
  { id: "phone", label: "Phone number", hint: "E.164 number from Twilio / Telnyx / Plivo (phase 3)." },
  { id: "sms", label: "SMS", hint: "E.164 number." },
  { id: "webhook", label: "Custom webhook", hint: "Any identifier your system sends." },
];

export function ChannelsView({ data }: { data: TenantData }) {
  const { run, pending } = useAction();
  const origin = data.origin;
  const [kind, setKind] = useState<Channel["kind"]>("whatsapp");
  const [externalId, setExternalId] = useState("");
  const [label, setLabel] = useState("");
  const [agentId, setAgentId] = useState(data.agents[0]?.id ?? "");

  const snippet = `<script src="${origin}/widget.js" data-key="${data.tenant.publicKey}" async></script>`;
  const webAgent = data.agents.find((a) => a.status === "live" && a.channels.includes("web"));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <SectionTitle icon={Code2}>Website widget</SectionTitle>
        <Card>
          <p className="mb-3 text-sm text-slate/70">Paste this one line before <code className="font-mono text-xs">&lt;/body&gt;</code> on any website: plain HTML, WordPress, Webflow, Squarespace or a Next.js site like Sunsational&apos;s. Colours and welcome text come from the Business page.</p>
          <CopyBox text={snippet} label="widget snippet" />
          <p className="mt-3 text-xs text-slate/55">
            {webAgent ? <>Visitors will talk to <b className="text-ink">{webAgent.name}</b>.</> : <>No live agent has the Website channel switched on yet, so the widget stays hidden. Turn it on under Agents.</>}
          </p>
        </Card>
      </div>

      <div>
        <SectionTitle icon={Plug}>Connected channels</SectionTitle>
        <Table
          minWidth={600}
          columns={["Channel", "ID", "Label", "Answered by", ""]}
          empty="No channels yet. Register a WhatsApp number below so the global router knows it belongs to this business."
          rows={data.channels.map((c) => [
            <Pill key="k" status={c.active ? "live" : "paused"} label={c.kind} />,
            <code key="i" className="font-mono text-xs">{c.externalId}</code>,
            c.label ?? "",
            data.agents.find((a) => a.id === c.agentId)?.name ?? "First live agent",
            <button key="d" onClick={() => run(() => deleteChannel(data.tenant.id, c.id))} className="text-ink/30 hover:text-coral" aria-label="Remove channel"><Trash2 className="h-4 w-4" /></button>,
          ])}
        />
        <Card className="mt-4" title="Add a channel">
          <form
            className="grid gap-4 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveChannel(data.tenant.id, { kind, externalId, label: label || null, agentId: agentId || null, active: true }), () => { setExternalId(""); setLabel(""); });
            }}
          >
            <Field label="Type" htmlFor="ch-kind">
              <select id="ch-kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as Channel["kind"])}>
                {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="ID" htmlFor="ch-id" hint={KINDS.find((k) => k.id === kind)?.hint}>
              <input id="ch-id" className={inputClass} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </Field>
            <Field label="Label" htmlFor="ch-label"><input id="ch-label" className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main WhatsApp" /></Field>
            <Field label="Answered by" htmlFor="ch-agent">
              <select id="ch-agent" className={inputClass} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">First live agent</option>
                {data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <div className="md:col-span-4"><Button variant="accent" disabled={pending}>Add channel</Button></div>
          </form>
        </Card>
      </div>

      <div>
        <SectionTitle icon={Webhook}>Endpoints for n8n and Meta</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="n8n → Wally">
            <CopyBox text={`POST ${origin}/api/webhooks/n8n`} label="n8n endpoint" />
            <p className="mt-3 text-xs text-slate/60">
              Headers: <code className="font-mono">X-Wally-Tenant: {data.tenant.slug}</code> and <code className="font-mono">X-Wally-Secret</code> (from Settings). Body actions: <code className="font-mono">message</code>, <code className="font-mono">event</code>, <code className="font-mono">approval</code>, <code className="font-mono">staff_reply</code>. See the n8n folder in the repo for ready-made workflows.
            </p>
          </Card>
          <Card title="Meta WhatsApp webhook (all businesses)">
            <CopyBox text={`${origin}/api/webhooks/whatsapp`} label="WhatsApp webhook" />
            <p className="mt-3 text-xs text-slate/60">One Meta app for every client: messages are routed to the right business by phone_number_id. Set the verify token and app secret in Settings first.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
