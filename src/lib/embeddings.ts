// Semantic knowledge search. Documents are embedded with OpenAI's
// text-embedding-3-small at 1024 dimensions (matching the knowledge_docs
// column) when an OpenAI key is set. Search then mixes full-text matches
// with meaning-based ones, so "can I bring my dog" finds the pets policy.
// Without a key, search stays full-text only.
import { getConfig } from "@/lib/settings";
import type { Store } from "@/lib/store/types";
import type { KnowledgeDoc, Tenant } from "@/lib/types";

const MODEL = "text-embedding-3-small";
const DIMS = 1024;
const USD_PER_M_TOKENS = 0.02;
const MIN_SIMILARITY = 0.3;

async function embed(tenantId: string, store: Store, inputs: string[]): Promise<number[][] | null> {
  const key = await getConfig(null, "OPENAI_API_KEY");
  if (!key || !inputs.length) return null;
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, dimensions: DIMS, input: inputs.map((t) => t.slice(0, 8000)) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    console.error("embeddings failed", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return null;
  }
  const d = (await res.json()) as { data: { embedding: number[]; index: number }[]; usage?: { total_tokens?: number } };
  const tokens = d.usage?.total_tokens ?? 0;
  await store.recordUsage(tenantId, { agentId: null, kind: "llm", model: MODEL, inputTokens: tokens, outputTokens: 0, minutes: 0, costUsd: (tokens / 1e6) * USD_PER_M_TOKENS });
  return d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
}

/** Embeds documents that don't have one yet (new, synced or uploaded). */
export async function embedPending(store: Store, tenant: Pick<Tenant, "id">, max = 200) {
  let done = 0;
  while (done < max) {
    const batch = await store.listUnembeddedKnowledge(tenant.id, 50);
    if (!batch.length) break;
    const vectors = await embed(tenant.id, store, batch.map((d) => `${d.title}\n${d.content}`));
    if (!vectors) break;
    for (let i = 0; i < batch.length; i++) await store.setKnowledgeEmbedding(tenant.id, batch[i].id, vectors[i]);
    done += batch.length;
  }
  return done;
}

/** Full-text and semantic results together, best first, no duplicates. */
export async function searchKnowledge(store: Store, tenant: Pick<Tenant, "id">, query: string, limit = 4): Promise<Pick<KnowledgeDoc, "id" | "title" | "content">[]> {
  const [text, vec] = await Promise.all([
    store.searchKnowledge(tenant.id, query, limit),
    embed(tenant.id, store, [query]).catch(() => null),
  ]);
  const semantic = vec ? (await store.matchKnowledge(tenant.id, vec[0], limit)).filter((d) => d.similarity >= MIN_SIMILARITY) : [];
  const out: Pick<KnowledgeDoc, "id" | "title" | "content">[] = [];
  // Interleave so the best of each kind comes first.
  for (let i = 0; i < Math.max(text.length, semantic.length); i++) {
    for (const d of [text[i], semantic[i]]) if (d && !out.some((o) => o.id === d.id)) out.push({ id: d.id, title: d.title, content: d.content });
  }
  return out.slice(0, limit + 1);
}

/** Splits long text (a PDF) into articles an agent can search. */
export function chunkText(text: string, size = 1800) {
  const paras = text.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > size) {
      chunks.push(cur);
      cur = "";
    }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
      continue;
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
