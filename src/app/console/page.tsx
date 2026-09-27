import { loadTeam } from "@/lib/teamData";
import { headers } from "next/headers";
import { isBillable } from "@/lib/billing";
import { HELPDESK_CHANNEL } from "@/lib/helpdesk";
import { Console, type ConsoleData } from "@/components/console/Console";
import { MODELS } from "@/lib/agent/models";
import { monthStartIso } from "@/lib/agent/policy";
import { N8N_EVENTS } from "@/lib/n8n";
import { ROLE_LIBRARY } from "@/lib/roles";
import { requireSession } from "@/lib/session";
import { settingsStatus } from "@/lib/settings";

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

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost:3000"}`;
  const now = new Date().getTime();

  const base = {
    now,
    origin,
    mode: session.mode,
    user: session.user,
    isPlatformAdmin: session.isPlatformAdmin,
    tenants: tenants.map((x) => ({ id: x.id, name: x.name, slug: x.slug, status: x.status })),
    roles: ROLE_LIBRARY,
    models: MODELS,
    n8nEvents: [...N8N_EVENTS],
  };

  if (!tenant) return <Console data={{ ...base, tenant: null }} />;

  const monthStart = monthStartIso();
  const earliest = windowStart(now, monthStart);
  const [agents, allConversations, approvals, audit, outcomes, usage, knowledge, channels, settings, contracts, monthConversations, team] = await Promise.all([
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
  ]);

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
  };
  return <Console data={data} />;
}
