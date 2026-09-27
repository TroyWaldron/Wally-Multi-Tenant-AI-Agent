// Persona versions and A/B tests. Each saved change to an agent's persona
// is kept as a version. While an experiment runs, a share of new chats get a
// saved version (B) instead of the current persona (A), and the console
// compares how the two did.
import type { Store } from "@/lib/store/types";
import type { Agent, PersonaSnapshot } from "@/lib/types";

export const snapshotOf = (a: Pick<Agent, "title" | "instructions" | "personality">): PersonaSnapshot => ({ title: a.title, instructions: a.instructions, personality: a.personality });

const same = (x: PersonaSnapshot, y: PersonaSnapshot) => JSON.stringify(snapshotOf(x)) === JSON.stringify(snapshotOf(y));

/** Keeps the agent's persona as a new version when it changed since the last one. */
export async function keepVersion(store: Store, agent: Agent, createdBy: string, note: string | null = null) {
  const [latest] = await store.listAgentVersions(agent.tenantId, agent.id);
  if (latest && same(latest.snapshot, agent)) return null;
  return store.addAgentVersion(agent.tenantId, { agentId: agent.id, snapshot: snapshotOf(agent), note, createdBy });
}

/** The persona a new chat gets while an experiment runs. */
export function pickVariant(agent: Agent, roll = Math.random() * 100): "A" | "B" | null {
  if (!agent.experiment) return null;
  return roll < agent.experiment.share ? "B" : "A";
}

/** The agent as this chat should see it: version B's persona for B chats. */
export async function withVariant(store: Store, agent: Agent, variant: "A" | "B" | null | undefined): Promise<Agent> {
  if (variant !== "B" || !agent.experiment) return agent;
  const v = (await store.listAgentVersions(agent.tenantId, agent.id)).find((x) => x.id === agent.experiment?.versionId);
  return v ? { ...agent, ...snapshotOf(v.snapshot) } : agent;
}
