// One-button health check for a business on Wally: every channel, key,
// workflow and AI staff member, with what to do when something is off.
// Read only; the only outbound calls are an n8n test ping, Slack's
// auth.test and each connector's tool list.
import { monthStartIso } from "@/lib/agent/policy";
import { SYNC_SOURCE } from "@/lib/knowledgeSource";
import { listConnectorTools } from "@/lib/mcp";
import { sendEvent } from "@/lib/n8n";
import { SCENARIO_RUN } from "@/lib/scenarioRunner";
import { getConfig } from "@/lib/settings";
import { slackApi, slackConfig } from "@/lib/slack";
import type { Store } from "@/lib/store/types";
import { isSupabaseConfigured, serviceClient } from "@/lib/supabase";
import { loadTeam } from "@/lib/teamData";
import type { Tenant } from "@/lib/types";

export type HealthStatus = "ok" | "warn" | "fail" | "off";
export type HealthItem = { area: string; label: string; status: HealthStatus; detail: string };

async function safe(area: string, label: string, fn: () => Promise<Omit<HealthItem, "area" | "label">>): Promise<HealthItem> {
  try {
    return { area, label, ...(await fn()) };
  } catch (err) {
    return { area, label, status: "fail", detail: err instanceof Error ? err.message : "Check failed." };
  }
}

export async function runHealthCheck(store: Store, tenant: Tenant): Promise<HealthItem[]> {
  const cfg = (k: string, platform = false) => getConfig(platform ? null : tenant.id, k);
  const [agents, channels, knowledge, connectors, audit, usage] = await Promise.all([
    store.listAgents(tenant.id),
    store.listChannels(tenant.id),
    store.listKnowledge(tenant.id),
    store.listConnectors(tenant.id),
    store.listAudit(tenant.id, 300),
    store.listUsage(tenant.id, monthStartIso()),
  ]);
  const live = agents.filter((a) => a.status === "live");

  const checks = await Promise.all([
    safe("Security", "Data isolation", async () => {
      if (!isSupabaseConfigured()) return { status: "warn", detail: "Demo mode: data is in memory, not in Supabase." };
      const { data, error } = await serviceClient().rpc("rls_gaps");
      if (error) return { status: "warn", detail: `Couldn't run the database check (${error.message}).` };
      const gaps = (data as { table_name: string }[]) ?? [];
      return gaps.length
        ? { status: "fail", detail: `Row Level Security is off on: ${gaps.map((g) => g.table_name).join(", ")}.` }
        : { status: "ok", detail: "Row Level Security is on for every table." };
    }),
    safe("AI", "AI providers", async () => {
      const keys = { Anthropic: await cfg("ANTHROPIC_API_KEY", true), OpenAI: await cfg("OPENAI_API_KEY", true), DeepSeek: await cfg("DEEPSEEK_API_KEY", true) };
      const on = Object.entries(keys).filter(([, v]) => v).map(([k]) => k);
      if (!on.length) return { status: "fail", detail: "No AI key is set, so agents answer in demo mode. Add one under AI models." };
      return { status: on.length > 1 ? "ok" : "warn", detail: `${on.join(", ")} set.${on.length === 1 ? " Add a second provider so there's a fallback." : ""}` };
    }),
    safe("AI", "AI staff", async () => {
      if (!live.length) return { status: "fail", detail: "No agent is live." };
      const team = await loadTeam(store, tenant.id);
      const down = team.filter((m) => m.health === "down");
      return down.length
        ? { status: "fail", detail: down.map((m) => `${m.name}: ${m.reason}`).join(" ") }
        : { status: "ok", detail: `${live.length} live: ${live.map((a) => a.name).join(", ")}.` };
    }),
    safe("AI", "Scenario tests", async () => {
      const guestFacing = live.filter((a) => a.channels.some((c) => c !== "ops" && c !== "playground"));
      const lines: string[] = [];
      let worst: HealthStatus = "ok";
      for (const a of guestFacing) {
        const run = audit.find((e) => e.action === SCENARIO_RUN && e.detail.agentId === a.id);
        if (!run) {
          lines.push(`${a.name}: never run.`);
          if (worst === "ok") worst = "warn";
          continue;
        }
        const passed = Number(run.detail.passed);
        const total = Number(run.detail.total);
        lines.push(`${a.name}: ${passed} of ${total} passed.`);
        if (passed < total) worst = "fail";
      }
      return guestFacing.length ? { status: worst, detail: `${lines.join(" ")}${worst !== "ok" ? " Press Run tests on the agent's card." : ""}` } : { status: "off", detail: "No guest-facing agent is live." };
    }),
    safe("AI", "Budgets", async () => {
      const tight = live
        .filter((a) => a.monthlyBudgetUsd > 0)
        .map((a) => ({ a, spent: usage.filter((u) => u.agentId === a.id).reduce((s, u) => s + u.costUsd, 0) }))
        .filter(({ a, spent }) => spent >= a.monthlyBudgetUsd * 0.8);
      return tight.length
        ? { status: "warn", detail: tight.map(({ a, spent }) => `${a.name} has used ${Math.round((spent / a.monthlyBudgetUsd) * 100)}% of its monthly budget.`).join(" ") }
        : { status: "ok", detail: "Every agent is within budget." };
    }),
    safe("Channels", "Website widget", async () => {
      const web = live.find((a) => a.channels.includes("web"));
      return web ? { status: "ok", detail: `${web.name} answers the website.` } : { status: "warn", detail: "No live agent has the Website channel on, so the widget stays hidden." };
    }),
    safe("Channels", "WhatsApp", async () => {
      const wa = channels.filter((c) => c.kind === "whatsapp" && c.active);
      if (!wa.length) return { status: "off", detail: "No WhatsApp number registered yet." };
      const ready = (await cfg("WHATSAPP_APP_SECRET", true)) && (await cfg("WHATSAPP_VERIFY_TOKEN", true));
      return ready ? { status: "ok", detail: `${wa.length} number${wa.length > 1 ? "s" : ""} registered.` } : { status: "fail", detail: "A number is registered but the Meta app secret or verify token is missing." };
    }),
    safe("Channels", "Slack", async () => {
      const s = await slackConfig(tenant.id);
      if (!s.token) return { status: "off", detail: "Not connected." };
      const r = (await slackApi(s.token, "auth.test", {})) as { ok?: boolean; error?: string; team?: string };
      if (!r.ok) return { status: "fail", detail: `Slack refused the bot token (${r.error ?? "error"}).` };
      if (!s.signingSecret) return { status: "fail", detail: "Signing secret missing, so Slack events are rejected." };
      return s.alertChannel ? { status: "ok", detail: `Connected to ${r.team ?? "the workspace"}.` } : { status: "warn", detail: "Connected, but no alert channel is set for handovers." };
    }),
    safe("Channels", "Voice notes", async () => ((await cfg("OPENAI_API_KEY")) ? { status: "ok", detail: "The website chat shows the mic." } : { status: "off", detail: "Add an OpenAI key to switch on voice notes." })),
    safe("Automation", "n8n", async () => {
      if (!(await cfg("N8N_WEBHOOK_URL"))) return { status: "fail", detail: "No n8n webhook URL, so live prices, availability and alerts can't run." };
      const r = await sendEvent(tenant, "test_ping", { message: "Wally health check" });
      return r.ok ? { status: "ok", detail: `n8n answered (HTTP ${r.status}).` } : { status: "fail", detail: `n8n didn't answer: ${r.error ?? `HTTP ${r.status}`}.` };
    }),
    safe("Automation", "Back-office alerts", async () => {
      const [url, secret] = [await cfg("BACKOFFICE_ALERT_URL"), await cfg("WIDGET_RELAY_SECRET")];
      if (!url) return { status: "off", detail: "No back-office alert URL, so handovers only reach n8n and Slack." };
      return secret ? { status: "ok", detail: "Handovers reach the business's own back office." } : { status: "fail", detail: "Alert URL set but the website relay secret is missing." };
    }),
    safe("Knowledge", "Knowledge base", async () => {
      if (!knowledge.length) return { status: "fail", detail: "No knowledge yet, so agents can't answer questions about the business." };
      const synced = knowledge.filter((k) => k.source === SYNC_SOURCE).length;
      return { status: "ok", detail: `${knowledge.length} documents${synced ? `, ${synced} synced from the website` : ""}.` };
    }),
    ...connectors
      .filter((c) => c.enabled)
      .map((c) =>
        safe("Connectors", c.name, async () => {
          const tools = await listConnectorTools(c, true);
          if (!c.agentIds.length) return { status: "warn", detail: `${tools.length} tools, but no AI staff may use it yet.` };
          return { status: "ok", detail: `${tools.length} tools available to ${c.agentIds.length} AI staff.` };
        })
      ),
  ]);

  await store.audit(tenant.id, {
    actorType: "system",
    actor: "health-check",
    action: "health.check",
    detail: { fail: checks.filter((c) => c.status === "fail").map((c) => c.label), warn: checks.filter((c) => c.status === "warn").map((c) => c.label) },
  });
  return checks;
}
