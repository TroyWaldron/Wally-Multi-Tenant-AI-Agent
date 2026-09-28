// The AI team talking to itself: finding the colleague a person (or another
// agent) means, even with a typo ("Cocoa" for Coco).
import type { Agent } from "@/lib/types";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** The agent a name refers to, allowing one typo for names of four letters or more. */
export function findColleague(agents: Agent[], name: string): Agent | null {
  const n = norm(name);
  if (!n) return null;
  return (
    agents.find((a) => norm(a.name) === n) ??
    agents.find((a) => norm(a.name).length >= 4 && distance(norm(a.name), n) <= 1) ??
    agents.find((a) => a.title && norm(a.title) === n) ??
    null
  );
}

/** The agent a message opens by addressing ("Coco, …", "@Ledger …", "Hi Sunny"). */
export function addressedAgent(agents: Agent[], text: string): Agent | null {
  const words = text.replace(/^\[[^\]]*\]\s*/, "").split(/\s+/).filter(Boolean);
  // "Coco, …" or "Hi Coco …": only the opening word (after a greeting) counts,
  // so "what did Coco say?" stays with whoever is being asked.
  const first = /^(hi|hey|hello|morning|ok|okay|yo)[,!.]?$/i.test(words[0] ?? "") ? words[1] : words[0];
  const mention = /@(\w+)/.exec(text)?.[1];
  return (mention ? findColleague(agents, mention) : null) ?? (first ? findColleague(agents, first.replace(/^@/, "")) : null);
}

export function teamLine(agents: Agent[], self: Agent) {
  const others = agents.filter((a) => a.id !== self.id && a.status === "live");
  if (!others.length) return "";
  return others.map((a) => `${a.name} (${a.title ?? a.templateKey ?? "AI staff"})`).join(", ");
}
