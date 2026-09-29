// Decision boundaries, enforced before any tool runs. The model is told its
// boundaries in the prompt, but this check is what actually holds the line.
import type { Agent } from "@/lib/types";

export type PolicyDecision = { decision: "allow" } | { decision: "approval"; reason: string } | { decision: "deny"; reason: string };

// Tools that are how an agent asks for help; never blocked, or it could get stuck.
const ALWAYS_ALLOWED = new Set(["request_approval", "escalate_to_human", "end_chat"]);

/** Tools back-office AI staff get for working with the team (see staffDesk.ts). */
export const OFFICE_TOOLS = new Set(["message_staff", "add_follow_up", "list_follow_ups", "close_follow_up", "add_calendar_entry", "create_document"]);
/** Every AI staff member may write emails; anything not to staff waits for approval (officeMail.ts). */
const EMAIL = "send_email";
/** Every AI staff member may ask another for information. */
const COLLEAGUE = "ask_colleague";
/** Every AI staff member may draft for a person to approve, and read past chats with someone. */
const DRAFTING = new Set(["draft_message", "look_up_history"]);

/** Back-office AI staff (channel "ops") work with the business's people, not its customers. */
export function worksWithTeam(agent: Pick<Agent, "channels">) {
  return agent.channels.includes("ops");
}

export function evaluate(agent: Agent, tool: string, input: Record<string, unknown>): PolicyDecision {
  const b = agent.boundaries;
  const office = (OFFICE_TOOLS.has(tool) && worksWithTeam(agent)) || tool === EMAIL || tool === COLLEAGUE || DRAFTING.has(tool);
  if (!ALWAYS_ALLOWED.has(tool) && !office && !b.allowedTools.includes(tool)) {
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
