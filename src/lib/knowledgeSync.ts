// Keeps a business's knowledge base in step with its own website. The site
// publishes its FAQ and descriptions as JSON ({ docs: [{ title, content }] }),
// and Wally re-imports it at most once a day, lazily when a chat comes in,
// or on demand from the Knowledge screen. Imported articles are tagged with
// the source "site-sync"; an article typed into the console with the same
// title is replaced, so the site stays the single source of truth.
import { after } from "next/server";
import { embedPending } from "@/lib/embeddings";
import { z } from "zod";
import { SYNC_SOURCE } from "@/lib/knowledgeSource";
import { systemStore } from "@/lib/session";
import { getConfig } from "@/lib/settings";
import type { Tenant } from "@/lib/types";

const SYNCED_AT_KEY = "KNOWLEDGE_SYNCED_AT";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const Feed = z.object({
  docs: z.array(z.object({ title: z.string().min(1).max(300), content: z.string().min(1).max(20000) })).max(500),
});

export type SyncResult = { ok: true; imported: number; removed: number } | { ok: false; error: string };

export async function syncKnowledge(tenant: Tenant): Promise<SyncResult> {
  // Service-role store: callers check access first, and a guest chat that
  // triggers the daily refresh has no user to act as.
  const store = systemStore();
  const url = await getConfig(tenant.id, "KNOWLEDGE_SYNC_URL");
  if (!url) return { ok: false, error: "Add the website's knowledge feed URL in Settings first." };

  let feed: z.infer<typeof Feed>;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) return { ok: false, error: `The feed answered HTTP ${res.status}.` };
    const parsed = Feed.safeParse(await res.json());
    if (!parsed.success) return { ok: false, error: "The feed isn't in the expected { docs: [{ title, content }] } shape." };
    feed = parsed.data;
  } catch (err) {
    return { ok: false, error: `Couldn't reach the feed: ${err instanceof Error ? err.message : String(err)}` };
  }
  // An empty feed is far more likely a broken site than a business with no FAQ.
  if (!feed.docs.length) return { ok: false, error: "The feed returned no articles, so nothing was changed." };

  const incoming = new Set(feed.docs.map((d) => d.title.trim().toLowerCase()));
  const existing = await store.listKnowledge(tenant.id);
  const stale = existing.filter((k) => k.source === SYNC_SOURCE || incoming.has(k.title.trim().toLowerCase()));
  for (const k of stale) await store.deleteKnowledge(tenant.id, k.id);
  for (const d of feed.docs) await store.addKnowledge(tenant.id, { title: d.title.trim(), content: d.content.trim(), source: SYNC_SOURCE });

  await store.setSetting(tenant.id, SYNCED_AT_KEY, new Date().toISOString(), false);
  after(() => embedPending(store, tenant).catch((err) => console.error("embedding failed", err)));
  await store.audit(tenant.id, { actorType: "system", actor: "knowledge-sync", action: "knowledge.synced", detail: { url, imported: feed.docs.length, removed: stale.length } });
  return { ok: true, imported: feed.docs.length, removed: stale.length };
}

export async function lastSyncedAt(tenantId: string) {
  return getConfig(tenantId, SYNCED_AT_KEY);
}

/** Re-imports when the last sync is over a day old. Never throws: a chat must not fail because the site is down. */
export async function syncKnowledgeIfStale(tenant: Tenant) {
  try {
    if (!(await getConfig(tenant.id, "KNOWLEDGE_SYNC_URL"))) return;
    const last = await lastSyncedAt(tenant.id);
    if (last && Date.now() - Date.parse(last) < MAX_AGE_MS) return;
    const r = await syncKnowledge(tenant);
    if (!r.ok) console.error(`Knowledge sync for ${tenant.slug} failed: ${r.error}`);
  } catch (err) {
    console.error(`Knowledge sync for ${tenant.slug} failed`, err);
  }
}
