"use client";

import { useState } from "react";
import { Cable, Trash2 } from "lucide-react";
import { deleteConnector, saveConnector, testConnector } from "@/app/console/actions";
import type { Connector } from "@/lib/types";
import type { TenantData } from "../Console";
import { Button, Card, Field, inputClass, Pill, SectionTitle, useAction } from "../ui";

type Tool = { name: string; description: string; readOnly: boolean };
const AUTH: { id: Connector["auth"]; label: string }[] = [
  { id: "relay_secret", label: "The business's website relay secret" },
  { id: "bearer", label: "A token for this connector" },
  { id: "none", label: "No sign-in" },
];

/**
 * A business's own systems, reached over MCP. Each connector says which AI
 * staff may use it and which of its tools need a person's approval first.
 */
export function ConnectorsSection({ data }: { data: TenantData }) {
  const { run, pending } = useAction();
  const [tools, setTools] = useState<Record<string, Tool[]>>({});
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<Connector["auth"]>("relay_secret");
  const [token, setToken] = useState("");
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const agentName = (id: string) => data.agents.find((a) => a.id === id)?.name ?? "removed";

  const save = (c: Connector & { hasToken: boolean }, patch: Partial<Connector>) =>
    run(() => saveConnector(data.tenant.id, { id: c.id, name: c.name, url: c.url, auth: c.auth, agentIds: c.agentIds, allowedTools: c.allowedTools, approvalTools: c.approvalTools, enabled: c.enabled, ...patch }));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div>
      <SectionTitle icon={Cable}>Connectors</SectionTitle>
      <p className="mb-4 max-w-3xl text-sm text-slate/60">
        Give your AI staff your own systems: a booking system, accounts, calendar. Any MCP server works. Choose who may use each one, and which actions need your approval first.
      </p>
      <div className="flex flex-col gap-4">
        {data.connectors.map((c) => {
          const list = tools[c.id];
          return (
            <Card key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{c.name}</span>
                    <Pill status={c.enabled ? "live" : "paused"} label={c.enabled ? "on" : "off"} />
                  </div>
                  <code className="font-mono text-xs text-slate/60">{c.url}</code>
                  {c.auth === "bearer" && !c.hasToken && <p className="mt-1 text-xs text-coral">No token saved yet.</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => testConnector(data.tenant.id, c.id), (r) => setTools((t) => ({ ...t, [c.id]: (r.data as Tool[]) ?? [] })))}>Test</Button>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => save(c, { enabled: !c.enabled })}>{c.enabled ? "Turn off" : "Turn on"}</Button>
                  <button onClick={() => run(() => deleteConnector(data.tenant.id, c.id))} className="px-1 text-ink/30 hover:text-coral" aria-label={`Remove ${c.name}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-ink/70">Who can use it:</span>
                {data.agents.map((a) => (
                  <button key={a.id} type="button" disabled={pending} onClick={() => save(c, { agentIds: toggle(c.agentIds, a.id) })}
                    className={`rounded-full border px-2.5 py-0.5 ${c.agentIds.includes(a.id) ? "border-teal bg-teal/10 text-teal" : "border-ink/15 text-slate/60"}`}>
                    {a.name}
                  </button>
                ))}
              </div>
              {list && (
                <div className="mt-3 overflow-x-auto">
                  {list.length === 0 ? <p className="text-xs text-slate/60">This server offers no tools.</p> : (
                    <table className="w-full min-w-[520px] text-left text-xs">
                      <thead><tr className="text-slate/50"><th className="py-1 pr-3 font-semibold">Tool</th><th className="py-1 pr-3 font-semibold">AI can use</th><th className="py-1 pr-3 font-semibold">Needs approval</th></tr></thead>
                      <tbody>
                        {list.map((t) => {
                          const visible = !c.allowedTools.length || c.allowedTools.includes(t.name);
                          const all = list.map((x) => x.name);
                          return (
                            <tr key={t.name} className="border-t border-ink/5 align-top">
                              <td className="py-1.5 pr-3"><code className="font-mono text-ink">{t.name}</code>{t.readOnly && <span className="ml-1 text-slate/50">read only</span>}<div className="text-slate/55">{t.description.slice(0, 140)}</div></td>
                              <td className="py-1.5 pr-3"><input type="checkbox" aria-label={`Let AI use ${t.name}`} checked={visible} disabled={pending}
                                onChange={() => {
                                  const next = visible ? all.filter((n) => n !== t.name && (!c.allowedTools.length || c.allowedTools.includes(n))) : [...c.allowedTools, t.name];
                                  // An empty list means "all tools", so hiding the last one keeps a placeholder.
                                  save(c, { allowedTools: next.length ? next : ["(none)"] });
                                }} /></td>
                              <td className="py-1.5 pr-3"><input type="checkbox" aria-label={`${t.name} needs approval`} checked={c.approvalTools.includes(t.name)} disabled={pending}
                                onChange={() => save(c, { approvalTools: toggle(c.approvalTools, t.name) })} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {!list && c.agentIds.length > 0 && <p className="mt-2 text-xs text-slate/55">Used by {c.agentIds.map(agentName).join(", ")}. Press Test to see its tools and choose which need approval.</p>}
            </Card>
          );
        })}

        <Card title="Add a connector">
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveConnector(data.tenant.id, { name, url, auth, token, agentIds, allowedTools: [], approvalTools: [], enabled: true }), () => { setName(""); setUrl(""); setToken(""); setAgentIds([]); });
            }}
          >
            <Field label="Name" htmlFor="cn-name"><input id="cn-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunsational Ops Hub" /></Field>
            <Field label="MCP server URL" htmlFor="cn-url"><input id="cn-url" className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.example.com/api/mcp" /></Field>
            <Field label="Sign in with" htmlFor="cn-auth">
              <select id="cn-auth" className={inputClass} value={auth} onChange={(e) => setAuth(e.target.value as Connector["auth"])}>
                {AUTH.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </Field>
            {auth === "bearer" ? (
              <Field label="Token" htmlFor="cn-token" hint="Stored as a secret. Never shown again."><input id="cn-token" type="password" autoComplete="off" className={inputClass} value={token} onChange={(e) => setToken(e.target.value)} /></Field>
            ) : <div />}
            <div className="md:col-span-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-ink/70">Who can use it:</span>
              {data.agents.map((a) => (
                <button key={a.id} type="button" onClick={() => setAgentIds((l) => toggle(l, a.id))}
                  className={`rounded-full border px-2.5 py-0.5 ${agentIds.includes(a.id) ? "border-teal bg-teal/10 text-teal" : "border-ink/15 text-slate/60"}`}>
                  {a.name}
                </button>
              ))}
            </div>
            <div className="md:col-span-2"><Button variant="accent" disabled={pending}>Add connector</Button></div>
          </form>
        </Card>
      </div>
    </div>
  );
}
