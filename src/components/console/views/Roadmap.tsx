"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { FEATURES, PHASES, type Phase } from "@/lib/roadmap";
import { cardClass } from "../ui";

export function RoadmapView() {
  const live = FEATURES.filter((f) => f.live).length;
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-slate/65">
        Every feature from the Wally concept, and the phase it lands in. {live} of {FEATURES.length} are working in this build; nothing from the concept has been dropped.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        {(Object.keys(PHASES) as Phase[]).map((p) => {
          const items = FEATURES.filter((f) => f.phase === p);
          return (
            <div key={p} className={`${cardClass} p-5`}>
              <div className="mb-3 flex items-baseline gap-2">
                <span className="font-mono text-xs font-medium text-lagoon">{p}</span>
                <h3 className="font-heading text-base font-semibold text-ink">{PHASES[p]}</h3>
              </div>
              <ul className="flex flex-col gap-2">
                {items.map((f) => (
                  <li key={f.name} className="flex items-start gap-2 text-sm">
                    {f.live ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-leaf" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink/20" />}
                    <span className={f.live ? "text-ink" : "text-slate/70"}>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate/45">{f.area} · </span>
                      {f.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
