"use client";

import { useEffect, useState } from "react";
import { loadMessages, setConversationStatus, staffReply } from "@/app/console/actions";
import type { Message } from "@/lib/types";
import type { TenantData } from "../Console";
import { Button, cardClass, Empty, inputClass, Pill, timeAgo, useAction } from "../ui";

export function ConversationsView({ data }: { data: TenantData }) {
  const [filter, setFilter] = useState<"all" | "waiting_human" | "open" | "closed">("all");
  const list = data.conversations.filter((c) => filter === "all" || c.status === filter);
  const [selected, setSelected] = useState<string | null>(list[0]?.id ?? null);
  const conv = data.conversations.find((c) => c.id === selected);

  if (!data.conversations.length) {
    return <Empty title="No conversations yet">Conversations from the website widget, WhatsApp and the Playground all land here.</Empty>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "waiting_human", "open", "closed"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === f ? "bg-ink text-white" : "bg-white text-ink/70 ring-1 ring-ink/10"}`}>
              {f === "waiting_human" ? "Needs a person" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className={`${cardClass} max-h-[70vh] divide-y divide-ink/5 overflow-y-auto`}>
          {list.map((c) => (
            <button key={c.id} onClick={() => setSelected(c.id)} className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition ${selected === c.id ? "bg-lagoon/8" : "hover:bg-paper"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-ink">{c.contact.name ?? c.contact.phone ?? c.contact.email ?? "Website visitor"}</span>
                <span className="shrink-0 text-[11px] text-slate/45">{timeAgo(c.updatedAt)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate/55">
                <span className="capitalize">{c.channel}</span>
                <span>·</span>
                <span>{data.agents.find((a) => a.id === c.agentId)?.name ?? "No agent"}</span>
                <span className="ml-auto"><Pill status={c.status} label={c.status === "waiting_human" ? "needs a person" : undefined} /></span>
              </div>
            </button>
          ))}
          {list.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate/45">Nothing in this filter.</div>}
        </div>
      </div>
      {conv ? <Transcript key={conv.id} data={data} conversationId={conv.id} /> : <Empty title="Pick a conversation" />}
    </div>
  );
}

function Transcript({ data, conversationId }: { data: TenantData; conversationId: string }) {
  const conv = data.conversations.find((c) => c.id === conversationId)!;
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reply, setReply] = useState("");
  const { run, pending } = useAction();

  useEffect(() => {
    let alive = true;
    loadMessages(data.tenant.id, conversationId).then((m) => alive && setMessages(m));
    return () => {
      alive = false;
    };
  }, [data.tenant.id, conversationId, conv.updatedAt]);

  const bubble: Record<string, string> = {
    user: "self-start border border-ink/8 bg-white text-ink",
    assistant: "self-end bg-lagoon text-white",
    staff: "self-end bg-ink text-white",
    system: "self-center bg-amber/15 text-[#6f4c0e] text-xs",
    tool: "self-center bg-paper text-xs",
  };

  return (
    <div className={`${cardClass} flex h-[75vh] flex-col overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/5 px-5 py-3">
        <div>
          <div className="font-semibold text-ink">{conv.contact.name ?? conv.contact.phone ?? "Website visitor"}</div>
          <div className="text-xs text-slate/55">{[conv.contact.phone, conv.contact.email, conv.channel].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="flex gap-2">
          {conv.status === "waiting_human" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setConversationStatus(data.tenant.id, conv.id, "open"))}>Hand back to agent</Button>
          ) : conv.status === "open" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setConversationStatus(data.tenant.id, conv.id, "waiting_human"))}>Take over</Button>
          ) : null}
          {conv.status !== "closed" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setConversationStatus(data.tenant.id, conv.id, "closed"))}>Close</Button>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-paper/50 p-5">
        {messages === null && <div className="text-sm text-slate/50">Loading…</div>}
        {messages?.map((m) => (
          <div key={m.id} className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${bubble[m.role] ?? bubble.tool}`}>
            {m.role === "staff" && <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">Team · {String(m.meta.by ?? "")}</div>}
            {m.content}
            {m.meta.sample ? <div className="mt-0.5 text-[10px] opacity-50">sample</div> : null}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => staffReply(data.tenant.id, conv.id, reply), () => setReply(""));
        }}
        className="flex gap-2 border-t border-ink/5 p-3"
      >
        <input id="staff-reply" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply as the team (sent through n8n on the original channel)…" className={inputClass} />
        <Button disabled={pending || !reply.trim()}>Send</Button>
      </form>
    </div>
  );
}
