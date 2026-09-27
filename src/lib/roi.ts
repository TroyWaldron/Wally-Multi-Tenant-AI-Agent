// Return on investment for a business owner: what the guest-facing AI staff
// saved and earned over 30 days against what the business pays Wally for
// them. Assumptions (minutes per chat, staff cost, exchange rate) are tenant
// settings with sensible defaults, and are returned with the figures so the
// owner can see exactly how they were worked out.
import { contractActiveOn, isBillable } from "@/lib/billing";
import { getConfig } from "@/lib/settings";
import type { Store } from "@/lib/store/types";
import type { Tenant } from "@/lib/types";
import { BACK_OFFICE } from "@/lib/team";

export const ROI_DAYS = 30;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 17;

export type Roi = {
  days: number;
  currency: string;
  assumptions: { minutesPerChat: number; hourlyCost: number; fxPerUsd: number };
  chats: number;
  handledAlone: number;
  afterHours: number;
  leads: number;
  hoursSaved: number;
  staffCostSaved: number;
  outcomeValue: number;
  /** What the business pays Wally for its guest-facing AI staff, per month, in its own currency. */
  cost: number;
  costUsd: number;
  net: number;
  /** Value for every 1 spent; null when nothing is charged yet. */
  multiple: number | null;
};

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const round = (n: number, p = 0) => Math.round(n * 10 ** p) / 10 ** p;

export async function computeRoi(store: Store, tenant: Tenant, now = new Date()): Promise<Roi> {
  const since = new Date(now.getTime() - ROI_DAYS * 86_400_000).toISOString();
  const today = now.toISOString().slice(0, 10);
  const [convs, approvals, outcomes, contracts, agents, minutes, hourly, fx] = await Promise.all([
    store.listConversationsSince(tenant.id, since),
    store.listApprovals(tenant.id),
    store.listOutcomes(tenant.id, 2000),
    store.listContracts(tenant.id),
    store.listAgents(tenant.id),
    getConfig(tenant.id, "ROI_MINUTES_PER_CHAT"),
    getConfig(tenant.id, "ROI_HOURLY_COST"),
    getConfig(tenant.id, "ROI_FX_PER_USD"),
  ]);
  const assumptions = { minutesPerChat: num(minutes, 6), hourlyCost: num(hourly, 50), fxPerUsd: num(fx, tenant.currency === "USD" ? 1 : 6.8) };

  const chats = convs.filter(isBillable);
  const ids = new Set(chats.map((c) => c.id));
  const handedOver = new Set([
    ...approvals.filter((a) => a.kind === "escalation" && a.conversationId && ids.has(a.conversationId)).map((a) => a.conversationId),
    ...chats.filter((c) => c.status === "waiting_human").map((c) => c.id),
  ]).size;
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, hour: "2-digit", hourCycle: "h23" });
  const afterHours = chats.filter((c) => {
    const h = Number(hour.format(new Date(c.createdAt)));
    return h < OPEN_HOUR || h >= CLOSE_HOUR;
  }).length;
  const recent = outcomes.filter((o) => o.createdAt >= since);

  // Only the guest-facing staff's agreements: back-office staff (a
  // coordinator, a bookkeeper) earn their keep in other ways.
  const guestFacing = new Set(agents.filter((a) => a.channels.some((c) => c !== BACK_OFFICE && c !== "playground")).map((a) => a.id));
  const toBusiness = (amount: number, currency: string) => (currency === tenant.currency ? amount : currency === "USD" ? amount * assumptions.fxPerUsd : amount);
  const active = contracts.filter((c) => contractActiveOn(c, today) && (!c.agentId || guestFacing.has(c.agentId)));
  const cost = active.reduce((s, c) => s + toBusiness(c.monthlyFee, c.currency), 0);
  const costUsd = active.reduce((s, c) => s + (c.currency === "USD" ? c.monthlyFee : c.monthlyFee / assumptions.fxPerUsd), 0);

  const handledAlone = chats.length - handedOver;
  const hoursSaved = (handledAlone * assumptions.minutesPerChat) / 60;
  const staffCostSaved = hoursSaved * assumptions.hourlyCost;
  const outcomeValue = recent.reduce((s, o) => s + o.value, 0);
  const value = staffCostSaved + outcomeValue;

  return {
    days: ROI_DAYS,
    currency: tenant.currency,
    assumptions,
    chats: chats.length,
    handledAlone,
    afterHours,
    leads: recent.filter((o) => o.kind === "lead").length,
    hoursSaved: round(hoursSaved, 1),
    staffCostSaved: round(staffCostSaved),
    outcomeValue: round(outcomeValue),
    cost: round(cost),
    costUsd: round(costUsd, 2),
    net: round(value - cost),
    multiple: cost > 0 ? round(value / cost, 1) : null,
  };
}
