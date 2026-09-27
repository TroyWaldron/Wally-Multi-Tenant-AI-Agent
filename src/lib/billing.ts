import { HELPDESK_CHANNEL } from "@/lib/helpdesk";
import type { Contract, Conversation } from "@/lib/types";

/**
 * The starting price for an AI receptionist, used to prefill a new contract.
 * Set against the market in 2026: AI chat agents from the big help desks
 * charge about US$0.99 to US$2 per resolved conversation, and hospitality
 * chat tools for small properties run about US$100 to US$400 a month. A flat
 * fee with a generous allowance is easier for a small business to budget,
 * and the overage rate stays below the per-resolution market.
 */
export const SUGGESTED_PLAN = {
  planName: "AI Receptionist",
  currency: "USD",
  monthlyFee: 149,
  includedConversations: 300,
  overageRate: 0.5,
  setupFee: 299,
} as const;

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
