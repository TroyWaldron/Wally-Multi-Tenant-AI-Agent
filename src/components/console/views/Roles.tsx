"use client";

import { Library, Mic } from "lucide-react";
import { hireAgent } from "@/app/console/actions";
import type { RoleTemplate } from "@/lib/types";
import { Button, cardClass, SectionTitle, useAction } from "../ui";

export function RolesView({ roles, tenantId, onHired }: { roles: RoleTemplate[]; tenantId: string | null; onHired: () => void }) {
  const { run, pending } = useAction();
  const groups = Array.from(new Set(roles.map((r) => r.category)));
  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-3xl text-sm text-slate/65">
        Every role ships with a job description, default decision boundaries and a personality. Hiring one creates a draft agent for the current business that you can tune and test before it goes live. All roles are voice-ready and can be embedded on a website.
      </p>
      {groups.map((g) => (
        <div key={g}>
          <SectionTitle icon={Library}>{g}</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {roles.filter((r) => r.category === g).map((r) => (
              <div key={r.key} className={`${cardClass} flex flex-col gap-3 p-5`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-heading text-base font-semibold text-ink">{r.name}</h3>
                  {r.voiceEnabled && <Mic className="h-3.5 w-3.5 text-lagoon" aria-label="Voice ready" />}
                </div>
                <p className="text-sm text-slate/65">{r.summary}</p>
                <div className="text-xs">
                  <div className="mb-1 font-semibold text-ink/70">Asks before</div>
                  <div className="flex flex-wrap gap-1">
                    {r.defaultBoundaries.approvalRequired.length ? r.defaultBoundaries.approvalRequired.map((x) => <span key={x} className="rounded-full bg-amber/15 px-2 py-0.5 text-[#7a5410]">{x}</span>) : <span className="text-slate/45">Advisory only, takes no actions</span>}
                  </div>
                </div>
                <div className="mt-auto">
                  <Button size="sm" variant="secondary" disabled={!tenantId || pending} onClick={() => tenantId && run(() => hireAgent(tenantId, r.key), onHired)}>
                    Hire for this business
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
