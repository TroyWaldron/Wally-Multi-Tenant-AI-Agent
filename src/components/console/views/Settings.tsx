"use client";

import { useState, useTransition } from "react";
import { BookOpen, Bot, Hash, KeyRound, MessageCircle, Send, ShieldCheck, TrendingUp, Workflow, Zap } from "lucide-react";
import { clearSetting, saveSetting, testN8n } from "@/app/console/actions";
import type { SettingStatus } from "@/lib/settings";
import type { TenantData } from "../Console";
import { CopyBox } from "./CopyBox";
import { Button, Card, cardClass, inputClass, SectionTitle, Table, useAction } from "../ui";

const SECTIONS: { id: SettingStatus["section"]; title: string; icon: typeof Bot; blurb: string }[] = [
  { id: "n8n", title: "n8n (this business)", icon: Workflow, blurb: "Where Wally sends events and runs workflows for this business." },
  { id: "knowledge", title: "Website (this business)", icon: BookOpen, blurb: "Connects Wally to the business's own website: its knowledge feed, and the secret its server uses to relay guest chats." },
  { id: "ai", title: "AI models (platform-wide)", icon: Bot, blurb: "Keys shared by every business on this Wally installation." },
  { id: "whatsapp", title: "WhatsApp Cloud API (platform-wide)", icon: MessageCircle, blurb: "One Meta app serves every client's number." },
  { id: "slack", title: "Slack (this business)", icon: Hash, blurb: "Guest handovers post to a Slack channel and a reply in the thread reaches the guest. The team can also DM the app to talk to the AI staff." },
  { id: "roi", title: "Return on investment (this business)", icon: TrendingUp, blurb: "Assumptions behind the ROI figures the owner sees. Leave blank for the defaults." },
];

export function SettingsView({ data }: { data: TenantData }) {
  const status = [
    { label: "Database", ok: data.mode === "supabase", detail: data.mode === "supabase" ? "Supabase connected, Row Level Security on" : "Demo mode: in-memory data. Add Supabase keys in Vercel to go live." },
    { label: "Claude (Anthropic)", ok: !!data.settings.find((s) => s.key === "ANTHROPIC_API_KEY")?.configured, detail: "Agents answer from the knowledge base only until a key is set." },
    { label: "n8n", ok: !!data.settings.find((s) => s.key === "N8N_WEBHOOK_URL")?.configured, detail: "Events, workflows and WhatsApp replies go through n8n." },
    { label: "WhatsApp webhook", ok: !!data.settings.find((s) => s.key === "WHATSAPP_APP_SECRET")?.configured && !!data.settings.find((s) => s.key === "WHATSAPP_VERIFY_TOKEN")?.configured, detail: "Needs a verify token and the Meta app secret." },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <SectionTitle icon={ShieldCheck}>System status</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          {status.map((s) => (
            <div key={s.label} className={`${cardClass} flex items-start gap-3 p-5`}>
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.ok ? "bg-leaf" : "bg-coral"}`} />
              <div>
                <div className="text-sm font-semibold text-ink">{s.label}</div>
                <div className="mt-0.5 text-xs text-slate/60">{s.ok ? "Connected" : s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle icon={KeyRound}>Integrations</SectionTitle>
        <p className="mb-4 max-w-3xl text-sm text-slate/60">
          Values saved here override Vercel environment variables. Secret fields never show their saved value, only whether one is set: leave a secret blank to keep it, or type a new value to replace it.
        </p>
        <div className="flex flex-col gap-5">
          {SECTIONS.map((sec) => {
            const fields = data.settings.filter((f) => f.section === sec.id);
            const locked = fields[0]?.scope === "platform" && !data.isPlatformAdmin;
            const card = <SettingsCard key={sec.id} tenantId={data.tenant.id} title={sec.title} icon={sec.icon} blurb={sec.blurb} fields={fields} locked={locked} />;
            if (sec.id !== "slack") return card;
            return (
              <div key={sec.id}>
                {card}
                <div className="mt-2 px-1 text-xs text-slate/60">
                  Slack Event Subscriptions Request URL:
                  <CopyBox text={`${data.origin}/api/webhooks/slack?key=${data.tenant.publicKey}`} label="Slack events URL" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <SectionTitle icon={Zap}>n8n events</SectionTitle>
        <p className="mb-4 max-w-3xl text-sm text-slate/60">
          Wally POSTs <code className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-xs">{`{ kind: "event", event, data, tenant, sentAt }`}</code> to the URL above as each of these happens, and{" "}
          <code className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-xs">{`{ kind: "workflow", workflow, input, context }`}</code> when an agent runs a workflow (answer with Respond to Webhook). Every call carries the X-Wally-Secret header.
        </p>
        <Table
          minWidth={480}
          columns={["Event", "Fires when"]}
          empty="No events."
          rows={data.n8nEvents.map((e) => [<code key="e" className="rounded bg-ink/5 px-2 py-1 font-mono text-xs font-medium text-ink">{e.event}</code>, e.when])}
        />
        <N8nTest tenantId={data.tenant.id} />
      </div>
    </div>
  );
}

function SettingsCard({ tenantId, title, icon: I, blurb, fields, locked }: { tenantId: string; title: string; icon: typeof Bot; blurb: string; fields: SettingStatus[]; locked: boolean }) {
  const { run, pending } = useAction();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.secret ? "" : f.value ?? ""])));

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <I className="h-4 w-4 text-lagoon" />
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <p className="-mt-2 mb-4 text-xs text-slate/55">{blurb}{locked ? " Only platform admins can change these." : ""}</p>
      <div className="flex flex-col gap-5">
        {fields.map((f) => (
          <div key={f.key} className="grid gap-2 md:grid-cols-[220px_1fr_auto] md:items-start">
            <div>
              <label htmlFor={`set-${f.key}`} className="text-sm font-medium text-ink">{f.label}</label>
              <div className={`mt-0.5 text-[11px] font-semibold ${f.configured ? "text-leaf" : "text-coral"}`}>
                {f.configured ? `Set (${f.source === "environment" ? "from Vercel env" : f.source === "tenant" ? "this business" : "platform"})` : "Not set"}
              </div>
            </div>
            <div>
              <input
                id={`set-${f.key}`}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                disabled={locked}
                className={inputClass}
                placeholder={f.secret && f.configured ? "•••••••• (leave blank to keep)" : f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
              <p className="mt-1 text-xs text-slate/55">{f.help}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={locked || pending} onClick={() => run(() => saveSetting(tenantId, f.key, values[f.key] ?? ""), () => f.secret && setValues((v) => ({ ...v, [f.key]: "" })))}>
                Save
              </Button>
              {f.configured && f.source !== "environment" && (
                <Button size="sm" variant="ghost" disabled={locked || pending} onClick={() => run(() => clearSetting(tenantId, f.key))}>Clear</Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function N8nTest({ tenantId }: { tenantId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button variant="accent" disabled={pending} onClick={() => start(async () => {
        const r = await testN8n(tenantId);
        setResult(r.ok ? { ok: true, text: r.message ?? "Delivered." } : { ok: false, text: r.error });
      })}>
        <Send className="h-4 w-4" /> {pending ? "Sending…" : "Send test event"}
      </Button>
      {result && <span className={`text-sm ${result.ok ? "text-leaf" : "text-coral"}`}>{result.text}</span>}
    </div>
  );
}
