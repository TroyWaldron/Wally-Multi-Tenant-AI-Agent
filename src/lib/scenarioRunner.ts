import { runAgent } from "@/lib/agent/runtime";
import { redactPII } from "@/lib/pii";
import { score, scenariosFor, type ScenarioResult } from "@/lib/scenarios";
import type { Store } from "@/lib/store/types";
import type { Agent, Tenant } from "@/lib/types";

export const SCENARIO_RUN = "scenario.run";

export type ScenarioRun = { agentId: string; passed: number; total: number; skipped?: string; results: ScenarioResult[]; ranAt: string; trigger: string };

/**
 * Runs an agent's scenario tests for real, in dry-run: each scenario is a
 * fresh playground conversation (never billed), tools that would change
 * anything are simulated, and nothing is sent to n8n. The result is kept in
 * the audit log so the console can show the latest run.
 */
export async function runScenarios(store: Store, tenant: Tenant, agent: Agent, trigger: string): Promise<ScenarioRun> {
  const results: ScenarioResult[] = [];
  let skipped: string | undefined;
  for (const s of scenariosFor(agent.templateKey)) {
    const conversation = await store.createConversation(tenant.id, { agentId: agent.id, channel: "playground", contact: { name: `Scenario test: ${s.name}` } });
    try {
      const run = await runAgent({ store, tenant, agent: { ...agent, status: "live" }, conversation, text: redactPII(s.says).text, dryRun: true });
      if (run.mode === "demo") {
        skipped = "No AI provider key is set, so tests can't run yet.";
        break;
      }
      results.push(score(s, run.reply, run.toolEvents));
    } catch (err) {
      results.push({ id: s.id, name: s.name, pass: false, checks: [{ label: `Ran without error (${err instanceof Error ? err.message : "failed"})`, pass: false }], reply: "", tools: [] });
    } finally {
      await store.setConversationStatus(tenant.id, conversation.id, "closed").catch(() => {});
    }
  }
  const out: ScenarioRun = { agentId: agent.id, passed: results.filter((r) => r.pass).length, total: results.length, skipped, results, ranAt: new Date().toISOString(), trigger };
  await store.audit(tenant.id, {
    actorType: "system",
    actor: "scenario-tests",
    action: SCENARIO_RUN,
    detail: { ...out, results: results.map((r) => ({ id: r.id, name: r.name, pass: r.pass, failed: r.checks.filter((c) => !c.pass).map((c) => c.label), tools: r.tools, reply: r.reply.slice(0, 400) })) },
  });
  return out;
}
