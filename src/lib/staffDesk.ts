// AI staff working with the business's people, not its customers: a
// coordinator or an accountant messages staff and managers, sets follow-ups,
// and Wally chases those when they fall due. Messages go to the business's
// back office (for example Sunsational's Operations Hub, which pushes them to
// phones by role) and to its Slack alert channel when one is set up.
import { getConfig } from "@/lib/settings";
import { slackApi, slackConfig } from "@/lib/slack";
import type { Store } from "@/lib/store/types";
import type { AgentTask, Tenant } from "@/lib/types";

export const MANAGERS = "managers";

export type StaffMessage = {
  agent: string;
  /** A person's name, or "managers". */
  to: string;
  text: string;
  conversationId?: string | null;
  taskId?: string | null;
  kind: "message" | "follow_up" | "reminder" | "overdue";
};

/** Sends a message from an AI staff member to a person or the managers. True when at least one route took it. */
export async function messageStaff(tenant: Pick<Tenant, "id">, m: StaffMessage) {
  const [url, secret] = await Promise.all([getConfig(tenant.id, "BACKOFFICE_ALERT_URL"), getConfig(tenant.id, "WIDGET_RELAY_SECRET")]);
  let delivered = false;
  if (url && secret) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Wally-Relay-Secret": secret },
        body: JSON.stringify({
          event: "agent_message",
          agent: m.agent,
          to: m.to,
          audience: m.to.toLowerCase() === MANAGERS ? "managers" : "person",
          kind: m.kind,
          text: m.text.slice(0, 1000),
          conversationId: m.conversationId ?? null,
          taskId: m.taskId ?? null,
          sentAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      delivered = res.ok;
      if (!res.ok) console.error(`agent_message to back office failed: HTTP ${res.status}`);
    } catch (err) {
      console.error("agent_message to back office failed:", err);
    }
  }
  const { token, alertChannel } = await slackConfig(tenant.id);
  if (token && alertChannel) {
    try {
      await slackApi(token, "chat.postMessage", { channel: alertChannel, text: `*${m.agent} → ${m.to}:* ${m.text.slice(0, 2500)}` });
      delivered = true;
    } catch (err) {
      console.error("agent_message to Slack failed:", err);
    }
  }
  return delivered;
}

/**
 * A due date as the agent gives it ("2026-10-02", "2026-10-02 15:00",
 * "2026-10-02T15:00") read in the business's time zone. Date only means 9am.
 */
export function dueAtFrom(input: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(input.trim());
  if (!m) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(input.trim()) && m[4]) {
    const d = new Date(input.trim());
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] ?? "09", m[5] ?? "00"].map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return new Date(guess - offsetMs(guess, timeZone)).toISOString();
}

// How far the zone's wall clock is ahead of UTC at a moment.
function offsetMs(at: number, timeZone: string) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(at))
        .map((p) => [p.type, p.value])
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - at;
  } catch {
    return 0;
  }
}

export function whenIn(iso: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const HOUR = 3_600_000;
/** Chase a due follow-up at most this often, and tell managers after this many chases. */
const CHASE_EVERY = 20 * HOUR;
const CHASES_BEFORE_MANAGERS = 2;

// Chasing runs whenever the back office or a cron looks at follow-ups; this
// keeps several of those close together from double-chasing.
const lastSweep = new Map<string, number>();

/** Reminds people about follow-ups that are due, and tells managers about ones that keep being ignored. */
export async function chaseDueTasks(store: Store, tenant: Tenant, opts: { force?: boolean } = {}) {
  const now = Date.now();
  if (!opts.force && now - (lastSweep.get(tenant.id) ?? 0) < 10 * 60_000) return { chased: 0 };
  lastSweep.set(tenant.id, now);
  const agents = await store.listAgents(tenant.id);
  const open = await store.listTasks(tenant.id, "open");
  let chased = 0;
  for (const t of open) {
    if (new Date(t.dueAt).getTime() > now) continue;
    if (t.lastChasedAt && now - new Date(t.lastChasedAt).getTime() < CHASE_EVERY) continue;
    const agent = agents.find((a) => a.id === t.agentId)?.name ?? "Your AI coordinator";
    const escalate = t.chaseCount >= CHASES_BEFORE_MANAGERS && t.assignee.toLowerCase() !== MANAGERS;
    const text = escalate
      ? `${t.assignee} hasn't closed "${t.title}" (due ${whenIn(t.dueAt, tenant.timezone)}, reminded ${t.chaseCount} times). Can someone check in with them?`
      : `Reminder: "${t.title}" was due ${whenIn(t.dueAt, tenant.timezone)}.${t.detail ? ` ${t.detail}` : ""} Reply with an update or say it's done.`;
    await messageStaff(tenant, { agent, to: escalate ? MANAGERS : t.assignee, text, taskId: t.id, conversationId: t.conversationId, kind: escalate ? "overdue" : "reminder" });
    await store.updateTask(tenant.id, t.id, { chaseCount: t.chaseCount + 1, lastChasedAt: new Date(now).toISOString() });
    await store.audit(tenant.id, { actorType: "agent", actor: agent, action: escalate ? "follow_up.overdue" : "follow_up.chased", detail: { taskId: t.id, assignee: t.assignee } });
    chased++;
  }
  return { chased };
}

/** Plain lines for an agent's tool result. */
export function describeTasks(tasks: AgentTask[], timeZone: string) {
  if (!tasks.length) return "No open follow-ups.";
  return tasks.map((t) => `- [${t.id}] ${t.title}, for ${t.assignee}, due ${whenIn(t.dueAt, timeZone)}${t.chaseCount ? `, reminded ${t.chaseCount}x` : ""}`).join("\n");
}
