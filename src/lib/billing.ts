import { HELPDESK_CHANNEL } from "@/lib/helpdesk";
import type { Contract, Conversation } from "@/lib/types";

/**
 * Introductory prices per AI employee, by seniority (set by Troy, 2026-09-27).
 * An AI employee is priced like staff: a receptionist costs less than a
 * coordinator, a manager or a CEO, because the senior roles carry more
 * tools, more judgement and more model time per task. The entry price is
 * deliberately low (US$25 a month) to win first customers; market rates for
 * AI chat agents are about US$1 to US$2 per resolved chat, so there is room
 * to raise these later by contract.
 */
export const PRICE_TIERS = [
  { key: "front", name: "Front line", monthlyFee: 25, includedConversations: 150, overageRate: 0.25, roles: ["receptionist", "data-entry", "secretary"] },
  { key: "specialist", name: "Specialist", monthlyFee: 45, includedConversations: 200, overageRate: 0.3, roles: ["coordinator", "sales", "accountant", "engineer"] },
  { key: "manager", name: "Manager", monthlyFee: 75, includedConversations: 250, overageRate: 0.4, roles: ["ops-manager", "general-manager", "consultant", "expert"] },
  { key: "executive", name: "Executive", monthlyFee: 120, includedConversations: 300, overageRate: 0.5, roles: ["ceo", "board-member"] },
] as const;

export type PriceTier = (typeof PRICE_TIERS)[number];

/** The price tier for a role; unknown roles price as specialists. */
export function tierFor(roleKey: string | null | undefined): PriceTier {
  return PRICE_TIERS.find((t) => (t.roles as readonly string[]).includes(roleKey ?? "")) ?? PRICE_TIERS[1];
}

/** A new agreement for one AI employee, prefilled from its role's tier. */
export function suggestedPlan(roleKey: string | null | undefined, roleName?: string) {
  const t = tierFor(roleKey);
  return {
    planName: `AI ${roleName ?? t.name} (introductory)`,
    currency: "USD",
    monthlyFee: t.monthlyFee,
    includedConversations: t.includedConversations,
    overageRate: t.overageRate,
    setupFee: 0,
  };
}

/** The receptionist plan; kept for callers that price the default front-desk agent. */
export const SUGGESTED_PLAN = suggestedPlan("receptionist", "Receptionist");

/** Conversations a business is billed for: real guests, not tests or helpdesk tickets. */
export function isBillable(c: Pick<Conversation, "channel">) {
  return c.channel !== "playground" && c.channel !== HELPDESK_CHANNEL;
}

/** Whether a contract applies on a given day (ISO date or timestamp). */
export function contractActiveOn(c: Contract, when: string) {
  const day = when.slice(0, 10);
  return c.status === "active" && c.startsOn <= day && (!c.endsOn || c.endsOn >= day);
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** This month's charge under a contract, given how many billable conversations it covered. */
export function monthCharge(c: Contract, conversations: number) {
  const extra = Math.max(0, conversations - c.includedConversations);
  const overage = cents(extra * c.overageRate);
  return {
    conversations,
    included: c.includedConversations,
    extra,
    monthlyFee: c.monthlyFee,
    overage,
    total: cents(c.monthlyFee + overage),
  };
}
