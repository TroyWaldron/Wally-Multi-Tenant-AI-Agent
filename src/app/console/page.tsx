import { tokenKey } from "@/lib/mcp";
import { loadTeam } from "@/lib/teamData";
import { computeRoi } from "@/lib/roi";
import { headers } from "next/headers";
import { contractActiveOn, isBillable } from "@/lib/billing";
import { HELPDESK_CHANNEL } from "@/lib/helpdesk";
import { Console, type AgencyView, type ConsoleData } from "@/components/console/Console";
import { MODELS } from "@/lib/agent/models";
import { monthStartIso } from "@/lib/agent/policy";
import { N8N_EVENTS } from "@/lib/n8n";
import { ROLE_LIBRARY } from "@/lib/roles";
import { requireSession, systemStore } from "@/lib/session";
import { getConfig, settingsStatus } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Computed once per request and passed down, so client views render the same
// "now" on server and client.
function windowStart(now: number, monthStart: string) {
  const since30 = new Date(now - 30 * 86_400_000).toISOString();
  return since30 < monthStart ? since30 : monthStart;
}

export default async function ConsolePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const session = await requireSession();
  const { store } = session;
  const tenants = await store.listTenants();
  const { t } = await searchParams;
  const tenant = tenants.find((x) => x.slug === t) ?? tenants[0] ?? null;

  // Agencies this person can see (all for the Wally team, their own for an
  // agency admin), each with its clients and what they pay per month.
  const today = new Date().toISOString().slice(0, 10);
  const agencyList = await store.listAgencies();
  const agencies: AgencyView[] = await Promise.all(
    agencyList.map(async (a) => {
      const clients = await Promise.all(
        tenants
          .filter((x) => x.agencyId === a.id)
          .map(async (x) => {
            const contracts = await store.listContracts(x.id);
            const active = contracts.filter((c) => contractActiveOn(c, today));
            const monthlyPrice = active.reduce((sum, c) => sum + c.monthlyFee, 0);
            return { id: x.id, name: x.name, slug: x.slug, status: x.status, currency: active[0]?.currency ?? x.currency, monthlyPrice };
          })
      );
      const invites = session.isPlatformAdmin ? await store.listAgencyInvites(a.id) : [];
      return { ...a, clients, invites };
    })
  );

  // White-label: everyone except the Wally team sees the agency's brand.
  const brandAgency = session.isPlatformAdmin
    ? null
    : tenant?.agencyId
      ? (agencyList.find((a) => a.id === tenant.agencyId) ?? (await systemStore().getAgency(tenant.agencyId)))
      : (agencyList[0] ?? null);
  const brand = brandAgency?.branding.brandName
    ? { name: brandAgency.branding.brandName, color: brandAgency.branding.color ?? null, logo: brandAgency.branding.logo ?? null }
    : null;

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost:3000"}`;
  const now = new Date().getTime();

  const base = {
    now,
    origin,
    mode: session.mode,
    user: session.user,
    isPlatformAdmin: session.isPlatformAdmin,
    agencyIds: session.agencyIds,
    agencies,
    brand,
    tenants: tenants.map((x) => ({ id: x.id, name: x.name, slug: x.slug, status: x.status })),
    roles: ROLE_LIBRARY,
    models: MODELS,
    n8nEvents: [...N8N_EVENTS],
  };

  if (!tenant) return <Console data={{ ...base, tenant: null }} />;

  const monthStart = monthStartIso();
  const earliest = windowStart(now, monthStart);
  const [agents, allConversations, approvals, audit, outcomes, usage, knowledge, channels, settings, contracts, monthConversations, team, roi, connectors] = await Promise.all([
    store.listAgents(tenant.id),
    store.listConversations(tenant.id, 150),
    store.listApprovals(tenant.id),
    store.listAudit(tenant.id, 150),
    store.listOutcomes(tenant.id, 300),
    store.listUsage(tenant.id, earliest),
    store.listKnowledge(tenant.id),
    store.listChannels(tenant.id),
    settingsStatus(tenant.id),
    store.listContracts(tenant.id),
    store.listConversationsSince(tenant.id, monthStart),
    loadTeam(store, tenant.id),
    computeRoi(store, tenant),
    store.listConnectors(tenant.id),
  ]);
  const tokens = await Promise.all(connectors.map((c) => (c.auth === "bearer" ? getConfig(tenant.id, tokenKey(c.id)) : Promise.resolve(undefined))));

  const billableThisMonth: Record<string, number> = {};
  for (const c of monthConversations.filter(isBillable)) {
    billableThisMonth.all = (billableThisMonth.all ?? 0) + 1;
    if (c.agentId) billableThisMonth[c.agentId] = (billableThisMonth[c.agentId] ?? 0) + 1;
  }

  // Helpdesk tickets (the business asking Wally for help) live alongside
  // guest conversations in storage but get their own page.
  const conversations = allConversations.filter((c) => c.channel !== HELPDESK_CHANNEL);
  const helpdesk = allConversations.filter((c) => c.channel === HELPDESK_CHANNEL);

  const data: ConsoleData = {
    ...base,
    tenant,
    agents,
    conversations,
    helpdesk,
    approvals,
    audit,
    outcomes,
    usage,
    knowledge,
    channels,
    settings,
    monthStart,
    contracts,
    billableThisMonth,
    team,
    roi,
    connectors: connectors.map((c, i) => ({ ...c, hasToken: Boolean(tokens[i]) })),
  };
  return <Console data={data} />;
}
