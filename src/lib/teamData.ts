import { getConfig } from "@/lib/settings";
import type { Store } from "@/lib/store/types";
import { CHECK_IN, teamOf } from "@/lib/team";

/** The tenant's AI team with live health, for the console and the partner API. */
export async function loadTeam(store: Store, tenantId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [agents, conversations, audit, anthropic, deepseek, openai] = await Promise.all([
    store.listAgents(tenantId),
    store.listConversationsSince(tenantId, since),
    store.listAudit(tenantId, 300),
    getConfig(null, "ANTHROPIC_API_KEY"),
    getConfig(null, "DEEPSEEK_API_KEY"),
    getConfig(null, "OPENAI_API_KEY"),
  ]);
  const lastActive: Record<string, string> = {};
  const seen = (id: string | null | undefined, at: string) => {
    if (id && (!lastActive[id] || at > lastActive[id])) lastActive[id] = at;
  };
  // Last conversation started (the light listing has no update time).
  for (const c of conversations) if (c.channel !== "playground") seen(c.agentId, c.createdAt);
  for (const e of audit) if (e.action === CHECK_IN) seen(e.actor, e.createdAt);
  return teamOf(agents, { keys: { anthropic: !!anthropic, deepseek: !!deepseek, openai: !!openai }, lastActive, now });
}
