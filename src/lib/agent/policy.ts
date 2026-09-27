// Decision boundaries, enforced before any tool runs. The model is told its
// boundaries in the prompt, but this check is what actually holds the line.
import type { Agent } from "@/lib/types";

export type PolicyDecision = { decision: "allow" } | { decision: "approval"; reason: string } | { decision: "deny"; reason: string };

// Tools that are how an agent asks for help; never blocked, or it could get stuck.
const ALWAYS_ALLOWED = new Set(["request_approval", "escalate_to_human"]);

export function evaluate(agent: Agent, tool: string, input: Record<string, unknown>): PolicyDecision {
  const b = agent.boundaries;
  if (!ALWAYS_ALLOWED.has(tool) && !b.allowedTools.includes(tool)) {
    return { decision: "deny", reason: `${agent.name} is not allowed to use ${tool}.` };
  }
  if (tool === "run_workflow") {
    const wf = String(input.workflow ?? "");
    if (!b.workflows.includes(wf)) return { decision: "deny", reason: `Workflow "${wf}" is not enabled for ${agent.name}.` };
    if (b.approvalRequired.includes(wf)) return { decision: "approval", reason: `"${wf}" needs a human's approval.` };
  }
  return { decision: "allow" };
}

export function budgetExceeded(agent: Agent, spentThisMonthUsd: number) {
  return agent.monthlyBudgetUsd > 0 && spentThisMonthUsd >= agent.monthlyBudgetUsd;
}

export function monthStartIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
