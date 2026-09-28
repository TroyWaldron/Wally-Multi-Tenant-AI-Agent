// Deciding an approval, from the console or from Slack. Approved workflow
// and connector actions run straight away; a reason given when declining
// becomes a standing rule on the agent (the accountability loop).
import { callConnectorTool } from "@/lib/mcp";
import { notify, runWorkflow } from "@/lib/n8n";
import { deliver } from "@/lib/officeMail";
import type { EmailRequest } from "@/lib/email";
import type { Store } from "@/lib/store/types";
import type { Tenant } from "@/lib/types";

export type DecideResult = { ok: true; message: string } | { ok: false; error: string };

export async function decide(store: Store, tenant: Tenant, approvalId: string, decision: "approved" | "rejected", actor: string, lesson?: string): Promise<DecideResult> {
  const a = await store.decideApproval(tenant.id, approvalId, decision, actor);
  if (!a) return { ok: false, error: "That request was already decided." };
  await store.audit(tenant.id, { actorType: "user", actor, action: `approval.${decision}`, detail: { approvalId, action: a.action } });

  let note = decision === "approved" ? `The team approved: ${a.summary}` : `The team declined: ${a.summary}`;
  // Accountability loop: a reason given when declining becomes a standing
  // rule on the agent ("Can't do"), so it stops asking for the same thing.
  const rule = lesson?.trim().slice(0, 200);
  let learned = "";
  if (decision === "rejected" && rule && a.agentId) {
    const agent = (await store.listAgents(tenant.id)).find((x) => x.id === a.agentId);
    if (agent && !agent.boundaries.cannot.some((c) => c.toLowerCase() === rule.toLowerCase())) {
      await store.saveAgent(tenant.id, { ...agent, boundaries: { ...agent.boundaries, cannot: [...agent.boundaries.cannot, rule] } });
      await store.audit(tenant.id, { actorType: "user", actor, action: "policy.learned", detail: { agentId: agent.id, rule, approvalId } });
      learned = ` ${agent.name} will follow this from now on.`;
    }
    note += ` Reason: ${rule}`;
  }
  // Approved workflow actions run now, so the agent's request actually happens.
  if (decision === "approved" && typeof a.payload.workflow === "string") {
    const r = await runWorkflow(tenant, a.payload.workflow, (a.payload.input as Record<string, unknown>) ?? {}, { approvalId, approvedBy: actor });
    note += r.ok ? ` (workflow ${a.payload.workflow} ran)` : ` (workflow ${a.payload.workflow} could not run: ${r.error ?? `HTTP ${r.status}`})`;
  }
  if (decision === "approved" && typeof a.payload.connectorId === "string" && typeof a.payload.tool === "string") {
    const c = (await store.listConnectors(tenant.id)).find((x) => x.id === a.payload.connectorId);
    try {
      if (!c) throw new Error("connector removed");
      const out = await callConnectorTool(c, a.payload.tool, (a.payload.arguments as Record<string, unknown>) ?? {});
      note += ` (${c.name} did it: ${out.slice(0, 300)})`;
    } catch (err) {
      note += ` (${a.payload.tool} could not run: ${err instanceof Error ? err.message : "error"})`;
    }
  }
  if (decision === "approved" && a.payload.email && typeof a.payload.email === "object") {
    const email = a.payload.email as EmailRequest;
    try {
      await deliver(store, tenant, email);
      note += ` (sent to ${email.to.join(", ")})`;
      await store.audit(tenant.id, { actorType: "user", actor, action: email.invite ? "calendar.invited" : "email.sent", detail: { to: email.to, subject: email.subject, approvalId } });
    } catch (err) {
      note += ` (the email could not be sent: ${err instanceof Error ? err.message : "error"})`;
    }
  }
  if (a.conversationId) await store.addMessage(tenant.id, { conversationId: a.conversationId, role: "system", content: note, meta: { approvalId } });
  notify(tenant, "approval_decided", { approval: a });
  return { ok: true, message: decision === "approved" ? "Approved." : `Declined.${learned}` };
}
