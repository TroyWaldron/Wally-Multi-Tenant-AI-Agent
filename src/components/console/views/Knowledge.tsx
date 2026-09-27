"use client";

import { useState } from "react";
import { BookOpen, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { addKnowledge, deleteKnowledge, syncKnowledgeNow, testKnowledgeSearch } from "@/app/console/actions";
import { SYNC_SOURCE } from "@/lib/knowledgeSource";
import type { TenantData } from "../Console";
import { Button, Card, cardClass, Field, inputClass, SectionTitle, useAction } from "../ui";

export function KnowledgeView({ data }: { data: TenantData }) {
  const { run, pending } = useAction();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; title: string }[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const feed = data.settings.find((f) => f.key === "KNOWLEDGE_SYNC_URL");
  const synced = data.knowledge.filter((k) => k.source === SYNC_SOURCE).length;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div>
        <SectionTitle icon={BookOpen}>{data.knowledge.length} articles your agents can search</SectionTitle>
        <div className={`${cardClass} divide-y divide-ink/5`}>
          {data.knowledge.map((k) => (
            <div key={k.id} className="px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => setOpen(open === k.id ? null : k.id)} className="text-left text-sm font-semibold text-ink hover:text-lagoon">{k.title}</button>
                <button onClick={() => run(() => deleteKnowledge(data.tenant.id, k.id))} className="shrink-0 text-ink/30 hover:text-coral" aria-label={`Delete ${k.title}`}><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="text-[11px] text-slate/45">{k.source === SYNC_SOURCE ? "From your website" : k.source}</div>
              {open === k.id && <p className="mt-2 whitespace-pre-wrap text-sm text-slate/75">{k.content}</p>}
            </div>
          ))}
          {data.knowledge.length === 0 && <div className="px-5 py-10 text-center text-sm text-slate/45">No knowledge yet. Paste your FAQ, prices and policies on the right.</div>}
        </div>
      </div>
      <div className="flex flex-col gap-6">
        <Card title="Sync from your website">
          {feed?.configured ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-slate/70">
                {synced} articles come from <span className="break-all font-medium text-ink">{feed.value}</span>. Wally refreshes them every day; edit them on your website, not here.
              </p>
              <Button variant="secondary" disabled={pending} onClick={() => run(() => syncKnowledgeNow(data.tenant.id))}><RefreshCw className="h-4 w-4" /> Sync now</Button>
            </div>
          ) : (
            <p className="text-sm text-slate/70">Add your website&apos;s knowledge feed in Settings and Wally will keep these articles up to date on its own.</p>
          )}
        </Card>
        <Card title="Add an article">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addKnowledge(data.tenant.id, title, content), () => { setTitle(""); setContent(""); });
            }}
          >
            <Field label="Title" htmlFor="kb-title"><input id="kb-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Airport transfers" /></Field>
            <Field label="Content" htmlFor="kb-content" hint="Plain text. Write it the way you'd explain it to a new staff member."><textarea id="kb-content" rows={8} className={inputClass} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
            <Button variant="accent" disabled={pending}><Plus className="h-4 w-4" /> Add</Button>
          </form>
        </Card>
        <Card title="Test a search">
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); setHits(await testKnowledgeSearch(data.tenant.id, q)); }}>
            <input id="kb-q" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="deposit refund" />
            <Button variant="secondary" aria-label="Search"><Search className="h-4 w-4" /></Button>
          </form>
          {hits && (
            <ol className="mt-3 list-decimal pl-5 text-sm text-ink">
              {hits.map((h) => <li key={h.id}>{h.title}</li>)}
              {hits.length === 0 && <li className="list-none text-slate/50">No matches. An agent would offer to ask the team.</li>}
            </ol>
          )}
        </Card>
        <p className="text-xs text-slate/50">Coming next: upload PDFs into this list, with semantic (vector) search per business.</p>
      </div>
    </div>
  );
}
