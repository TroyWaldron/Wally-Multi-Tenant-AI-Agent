"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RotateCcw, Send, ShieldCheck } from "lucide-react";
import type { ToolEvent } from "@/lib/agent/runtime";
import type { TenantData } from "../Console";
import { Button, cardClass, inputClass, Pill, usd } from "../ui";
import { RichText } from "./RichText";

type Turn = { role: "user" | "assistant"; text: string; tools?: ToolEvent[]; model?: string | null; cost?: number; mode?: string };

const STARTERS = [
  "Hi! Do you have a villa for 8 people 12-16 December?",
  "What's your cancellation policy?",
  "Can you give me a 15% discount if I book 5 nights?",
  "The AC in our villa stopped working, who do I call?",
];

export function PlaygroundView({ data, initialAgentId }: { data: TenantData; initialAgentId: string | null }) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(initialAgentId ?? data.agents.find((a) => a.status === "live")?.id ?? data.agents[0]?.id ?? "");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const agent = data.agents.find((a) => a.id === agentId);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const reset = () => {
    setTurns([]);
    setConversationId(null);
    setError(null);
  };

  const send = async (message: string) => {
    if (!message.trim() || !agentId || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    setTurns((t) => [...t, { role: "user", text: message }]);
    try {
      const res = await fetch("/api/console/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: data.tenant.id, agentId, text: message, conversationId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The agent didn't answer.");
      setConversationId(body.conversationId);
      setTurns((t) => [...t, { role: "assistant", text: body.reply ?? "(handed to a person)", tools: body.toolEvents, model: body.model, cost: body.costUsd, mode: body.mode }]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (!data.agents.length) return <p className="text-sm text-slate/60">Hire an agent first, then test it here.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className={`${cardClass} flex h-[calc(100vh-220px)] min-h-[480px] flex-col overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink/5 px-5 py-3">
          <label htmlFor="pg-agent" className="text-xs font-semibold text-ink/70">Talking to</label>
          <select id="pg-agent" value={agentId} onChange={(e) => { setAgentId(e.target.value); reset(); }} className={`${inputClass} sm:w-72`}>
            {data.agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.status})</option>)}
          </select>
          <Button size="sm" variant="ghost" onClick={reset} className="ml-auto"><RotateCcw className="h-3.5 w-3.5" /> New conversation</Button>
        </div>

        <div ref={logRef} className="flex flex-1 flex-col gap-4 overflow-y-auto bg-paper/60 p-5">
          {turns.length === 0 && (
            <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
              <p className="text-sm text-slate/60">Chat as if you were a customer. You&apos;ll see every tool {agent?.name} uses and every boundary check, exactly as it would run on WhatsApp or the website.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs text-ink hover:border-lagoon">{s}</button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`flex flex-col gap-1.5 ${t.role === "user" ? "items-end" : "items-start"}`}>
              {t.tools?.map((ev, j) => (
                <div key={j} className="flex max-w-[85%] items-start gap-2 rounded-lg border border-ink/8 bg-white px-3 py-2 text-xs">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lagoon" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono font-medium text-ink">{ev.tool}</code>
                      <Pill status={ev.outcome} />
                    </div>
                    <div className="mt-1 break-words font-mono text-[11px] text-slate/60">{JSON.stringify(ev.input)}</div>
                    <details className="mt-1 text-slate/70">
                      <summary className="cursor-pointer text-[11px]">Result</summary>
                      <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px]">{ev.result}</div>
                    </details>
                  </div>
                </div>
              ))}
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${t.role === "user" ? "whitespace-pre-wrap bg-ink text-white" : "border border-ink/8 bg-white text-ink"}`}>{t.role === "user" ? t.text : <RichText text={t.text} />}</div>
              {t.role === "assistant" && (
                <div className="text-[10px] text-slate/45">
                  {t.mode === "demo" ? "Demo mode (no API key)" : t.model ? `${t.model} · ${usd(t.cost ?? 0)}` : t.mode}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="text-xs text-slate/50">{agent?.name} is thinking…</div>}
          {error && <div className="rounded-lg bg-coral/10 px-3 py-2 text-sm text-coral">{error}</div>}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2 border-t border-ink/5 p-3">
          <input id="pg-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${agent?.name ?? "the agent"}…`} className={inputClass} disabled={busy} />
          <Button variant="accent" disabled={busy || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
      </div>

      {agent && (
        <aside className={`${cardClass} h-fit p-5 text-sm`}>
          <div className="font-heading text-base font-semibold text-ink">{agent.name}</div>
          <div className="mb-4 text-xs text-slate/55">{agent.title}</div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-lagoon">Asks you before</div>
          <div className="mb-4 flex flex-wrap gap-1">{agent.boundaries.approvalRequired.map((x) => <span key={x} className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] text-[#7a5410]">{x}</span>)}</div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-lagoon">Workflows</div>
          <div className="mb-4 flex flex-wrap gap-1">{agent.boundaries.workflows.map((x) => <span key={x} className="rounded-full bg-ink/6 px-2 py-0.5 text-[11px] text-ink">{x}</span>)}</div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-lagoon">Never</div>
          <ul className="list-disc pl-4 text-xs text-slate/70">{agent.boundaries.cannot.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="mt-4 text-[11px] text-slate/50">Playground chats are saved under Conversations on the &quot;playground&quot; channel, and count toward the agent&apos;s budget.</p>
        </aside>
      )}
    </div>
  );
}
