"use client";

import { useEffect, useState } from "react";
import { helpdeskReply, loadMessages, setConversationStatus } from "@/app/console/actions";
import type { Message } from "@/lib/types";
import type { TenantData } from "../Console";
import { Button, cardClass, Empty, inputClass, Pill, timeAgo, useAction } from "../ui";

const TOPIC: Record<string, string> = { problem: "Problem", hire: "Hire AI staff", question: "Question" };

/**
 * Tickets the business's own team opened from its back office (for
 * Sunsational, the Operations Hub's Help page): problems, requests to hire
 * more AI staff, questions. Answers here go straight back to them.
 */
export function HelpdeskView({ data }: { data: TenantData }) {
  const [selected, setSelected] = useState<string | null>(data.helpdesk[0]?.id ?? null);
  const ticket = data.helpdesk.find((t) => t.id === selected);

  if (!data.helpdesk.length) {
    return (
      <Empty title="No helpdesk tickets yet">
        When {data.tenant.name}&apos;s team asks for help or more AI staff from their own back office, it lands here.
      </Empty>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <div className={`${cardClass} max-h-[75vh] divide-y divide-ink/5 overflow-y-auto`}>
        {data.helpdesk.map((t) => (
          <button key={t.id} onClick={() => setSelected(t.id)} className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition ${selected === t.id ? "bg-lagoon/8" : "hover:bg-paper"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-ink">{t.contact.name ?? "Team member"}</span>
              <span className="shrink-0 text-[11px] text-slate/45">{timeAgo(t.updatedAt)}</span>
            </div>
            <div className="flex items-center text-xs text-slate/55">
              <span className="ml-auto">
                <Pill status={t.status} label={t.status === "waiting_human" ? "needs an answer" : t.status === "open" ? "answered" : undefined} />
              </span>
            </div>
          </button>
        ))}
      </div>
      {ticket ? <Thread key={ticket.id} data={data} ticketId={ticket.id} /> : <Empty title="Pick a ticket" />}
    </div>
  );
}

function Thread({ data, ticketId }: { data: TenantData; ticketId: string }) {
  const ticket = data.helpdesk.find((t) => t.id === ticketId)!;
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reply, setReply] = useState("");
  const { run, pending } = useAction();

  useEffect(() => {
    let alive = true;
    loadMessages(data.tenant.id, ticketId).then((m) => alive && setMessages(m));
    return () => {
      alive = false;
    };
  }, [data.tenant.id, ticketId, ticket.updatedAt]);

  const topic = messages?.find((m) => m.role === "user")?.meta.topic as string | undefined;

  return (
    <div className={`${cardClass} flex h-[75vh] flex-col overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/5 px-5 py-3">
        <div>
          <div className="font-semibold text-ink">{ticket.contact.name ?? "Team member"}</div>
          <div className="text-xs text-slate/55">{TOPIC[topic ?? ""] ?? "Question"} · from {data.tenant.name}</div>
        </div>
        {ticket.status !== "closed" && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setConversationStatus(data.tenant.id, ticket.id, "closed"))}>
            Close
          </Button>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-paper/50 p-5">
        {messages === null && <div className="text-sm text-slate/50">Loading…</div>}
        {messages
          ?.filter((m) => m.role === "user" || m.role === "staff")
          .map((m) => (
            <div key={m.id} className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${m.role === "user" ? "self-start border border-ink/8 bg-white text-ink" : "self-end bg-ink text-white"}`}>
              <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">
                {m.role === "user" ? String(m.meta.by ?? data.tenant.name) : `Wally · ${String(m.meta.by ?? "")}`}
              </div>
              {m.content}
            </div>
          ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => helpdeskReply(data.tenant.id, ticket.id, reply), () => setReply(""));
        }}
        className="flex gap-2 border-t border-ink/5 p-3"
      >
        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Answer ${data.tenant.name}'s team…`} className={inputClass} />
        <Button disabled={pending || !reply.trim()}>Send</Button>
      </form>
    </div>
  );
}
