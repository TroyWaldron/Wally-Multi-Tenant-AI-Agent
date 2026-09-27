// Call recording consent and transcript rules, ready for when a business's
// AI staff take calls. What the caller hears first depends on where the
// business is; a business can write its own notice in Settings > Calls.

/** Places where every party must agree to a recording (all-party consent). */
const ALL_PARTY = new Set(["DE", "FR", "ES", "IT", "NL", "IE", "GB", "CA", "AU", "US-CA", "US-FL", "US-IL", "US-MD", "US-MA", "US-MT", "US-NH", "US-PA", "US-WA", "US-CT", "US-DE", "US-NV", "US-MI", "US-OR"]);

export type CallPolicy = { notice: string; mustAsk: boolean; retentionDays: number };

export function callPolicy(business: { name: string; country: string }, settings: { notice?: string | null; retentionDays?: string | null }, callerRegion?: string): CallPolicy {
  // A US caller from an all-party state counts, whatever the business's country.
  const mustAsk = ALL_PARTY.has(business.country.toUpperCase()) || (callerRegion ? ALL_PARTY.has(callerRegion.toUpperCase()) : false);
  const fallback = mustAsk
    ? `Hi, you've reached ${business.name}. I'm an AI assistant and this call is recorded and transcribed so the team can follow up. Is that okay?`
    : `Hi, you've reached ${business.name}. I'm an AI assistant, and this call is recorded and transcribed so the team can follow up.`;
  const days = Number(settings.retentionDays);
  return { notice: settings.notice?.trim() || fallback, mustAsk, retentionDays: Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : 90 };
}
