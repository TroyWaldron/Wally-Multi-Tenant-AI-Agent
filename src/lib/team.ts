// The AI team as an organisation: who reports to whom, what each one does,
// and whether each is working right now. Shared by the console's org chart
// and dashboard and by the partner API, so the business's own back office
// shows the same picture.
import { tierFor, type PriceTier } from "@/lib/billing";
import { getModel } from "@/lib/agent/models";
import { getRole } from "@/lib/roles";
import type { Agent } from "@/lib/types";

export type Health = "up" | "down" | "waiting" | "paused" | "off";

export type TeamMember = {
  id: string;
  name: string;
  title: string | null;
  roleKey: string;
  roleName: string;
  summary: string;
  tier: PriceTier["key"];
  /** Guest-facing (answers customers) or back office (works for the team). */
  kind: "front" | "back";
  channels: string[];
  workflows: string[];
  needsApproval: string[];
  /** Another AI staff member, or null for the business's own people. */
  reportsTo: string | null;
  health: Health;
  reason: string;
  lastActiveAt: string | null;
};

/** Channel for AI staff who never talk to customers (a coordinator, a bookkeeper). */
export const BACK_OFFICE = "ops";

const LEVEL: Record<PriceTier["key"], number> = { executive: 0, manager: 1, specialist: 2, front: 2 };
const PROVIDER_NAME = { anthropic: "Anthropic", deepseek: "DeepSeek", openai: "OpenAI" } as const;
// Providers the router can actually call today.
const RUNNABLE = new Set(["anthropic", "deepseek"]);

/** A back-office agent that has not checked in for this long has missed its daily round. */
const HEARTBEAT_HOURS = 26;

export function teamOf(
  agents: Agent[],
  opts: {
    keys: Partial<Record<"anthropic" | "deepseek" | "openai", boolean>>;
    /** Most recent conversation or check-in per agent id. */
    lastActive: Record<string, string>;
    now?: Date;
  }
): TeamMember[] {
  const now = opts.now ?? new Date();
  const hired = agents.filter((a) => a.status !== "draft");

  const health = (a: Agent): { health: Health; reason: string } => {
    if (a.status === "draft") return { health: "off", reason: "Not deployed yet" };
    if (a.status === "paused") return { health: "paused", reason: "Paused by the team" };
    const ready = (id: string | null) => {
      const p = getModel(id)?.provider;
      return p && RUNNABLE.has(p) && opts.keys[p] ? p : null;
    };
    // The router falls back to any provider with a key, so an agent is only
    // down when no provider can run at all.
    const main = getModel(a.model)?.provider;
    if (!ready(a.model)) {
      if (ready(a.fallbackModel) || opts.keys.anthropic || opts.keys.deepseek)
        return { health: "up", reason: `Running on a backup model: no ${main ? PROVIDER_NAME[main] : "model"} key yet` };
      return { health: "down", reason: "No AI provider key set" };
    }
    if (a.channels.includes(BACK_OFFICE) && !a.channels.some((c) => c !== BACK_OFFICE && c !== "playground")) {
      const seen = opts.lastActive[a.id];
      if (!seen) return { health: "waiting", reason: "Waiting for the first daily round" };
      const hours = (now.getTime() - Date.parse(seen)) / 3_600_000;
      if (hours > HEARTBEAT_HOURS) return { health: "down", reason: `Missed the daily round (last seen ${Math.round(hours)} hours ago)` };
      return { health: "up", reason: "Daily round done" };
    }
    if (!a.channels.some((c) => c !== "playground")) return { health: "waiting", reason: "Live, but not on any channel yet" };
    return { health: "up", reason: "Answering" };
  };

  // Each AI staff member reports to the nearest hired AI with a more senior
  // role; otherwise to the business's own people.
  const reportsTo = (a: Agent) => {
    const level = LEVEL[tierFor(a.templateKey).key];
    const above = hired
      .filter((b) => b.id !== a.id && LEVEL[tierFor(b.templateKey).key] < level)
      .sort((x, y) => LEVEL[tierFor(y.templateKey).key] - LEVEL[tierFor(x.templateKey).key]);
    return above[0]?.id ?? null;
  };

  return agents.map((a) => {
    const role = getRole(a.templateKey);
    return {
      id: a.id,
      name: a.name,
      title: a.title,
      roleKey: a.templateKey,
      roleName: role?.name ?? a.templateKey,
      summary: role?.summary ?? "",
      tier: tierFor(a.templateKey).key,
      kind: a.channels.some((c) => c !== BACK_OFFICE && c !== "playground") ? "front" : "back",
      channels: a.channels.filter((c) => c !== "playground"),
      workflows: a.boundaries.workflows ?? [],
      needsApproval: a.boundaries.approvalRequired ?? [],
      reportsTo: a.status === "draft" ? null : reportsTo(a),
      ...health(a),
      lastActiveAt: opts.lastActive[a.id] ?? null,
    };
  });
}

export const HEALTH_LABEL: Record<Health, string> = {
  up: "Working",
  down: "Down",
  waiting: "Waiting",
  paused: "Paused",
  off: "Not deployed",
};

/** Audit action a back-office agent's daily round records (see /api/partner/check-in). */
export const CHECK_IN = "agent.check_in";
