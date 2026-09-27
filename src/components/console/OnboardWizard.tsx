"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Rocket } from "lucide-react";
import { onboardBusiness, type OnboardInput } from "@/app/console/actions";
import { tierFor } from "@/lib/billing";
import type { RoleTemplate } from "@/lib/types";
import { Button, Card, Field, inputClass, useAction } from "./ui";

const STEPS = ["Business", "AI staff", "Knowledge", "Price"] as const;
const TIMEZONES = ["America/Port_of_Spain", "America/Barbados", "America/Jamaica", "America/St_Lucia", "America/New_York", "Europe/London"];

/**
 * Onboard a new business in four short steps. Only the name is required, so
 * "Finish" works from any step; everything else can be filled in later.
 */
export function OnboardWizard({ roles }: { roles: RoleTemplate[] }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<OnboardInput>({
    name: "",
    industry: "",
    currency: "TTD",
    timezone: "America/Port_of_Spain",
    profile: {},
    staff: [{ roleKey: "receptionist", name: "" }],
    knowledge: "",
    knowledgeUrl: "",
    introPricing: true,
  });
  const set = <K extends keyof OnboardInput>(k: K, v: OnboardInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const prof = (k: keyof OnboardInput["profile"], v: string) => setF((x) => ({ ...x, profile: { ...x.profile, [k]: v } }));
  const toggleRole = (key: string) =>
    setF((x) => ({ ...x, staff: x.staff.some((s) => s.roleKey === key) ? x.staff.filter((s) => s.roleKey !== key) : [...x.staff, { roleKey: key, name: "" }] }));
  const nameRole = (key: string, name: string) => setF((x) => ({ ...x, staff: x.staff.map((s) => (s.roleKey === key ? { ...s, name } : s)) }));

  const finish = () => run(() => onboardBusiness(f), (r) => router.push(`/console?t=${r.data}`));
  const perMonth = f.staff.reduce((s, m) => s + tierFor(m.roleKey).monthlyFee, 0);

  return (
    <Card title={<span className="flex items-center gap-2"><Rocket className="h-4 w-4 text-amber" /> Onboard a business</span>}>
      <ol className="mb-5 flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => f.name.trim() && setStep(i)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ${i === step ? "bg-ink text-white" : i < step ? "bg-lagoon/15 text-lagoon" : "bg-paper text-slate/60"}`}
            >
              {i < step ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>} {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" htmlFor="ob-name"><input id="ob-name" className={inputClass} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Required" /></Field>
          <Field label="Industry" htmlFor="ob-ind"><input id="ob-ind" className={inputClass} value={f.industry} onChange={(e) => set("industry", e.target.value)} placeholder="Villa rentals, dental clinic…" /></Field>
          <Field label="Currency" htmlFor="ob-cur">
            <select id="ob-cur" className={inputClass} value={f.currency} onChange={(e) => set("currency", e.target.value)}>
              <option value="TTD">TT$ (TTD)</option><option value="USD">US$ (USD)</option><option value="BBD">BBD</option><option value="JMD">JMD</option><option value="XCD">EC$ (XCD)</option>
            </select>
          </Field>
          <Field label="Time zone" htmlFor="ob-tz">
            <select id="ob-tz" className={inputClass} value={f.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {TIMEZONES.map((z) => <option key={z} value={z}>{z.replace("America/", "").replace("Europe/", "").replace(/_/g, " ")}</option>)}
            </select>
          </Field>
          <Field label="Website" htmlFor="ob-web"><input id="ob-web" className={inputClass} value={f.profile.website ?? ""} onChange={(e) => prof("website", e.target.value)} /></Field>
          <Field label="Phone" htmlFor="ob-phone"><input id="ob-phone" className={inputClass} value={f.profile.phone ?? ""} onChange={(e) => prof("phone", e.target.value)} /></Field>
          <Field label="Email" htmlFor="ob-email"><input id="ob-email" className={inputClass} value={f.profile.email ?? ""} onChange={(e) => prof("email", e.target.value)} /></Field>
          <Field label="Opening hours" htmlFor="ob-hours"><input id="ob-hours" className={inputClass} value={f.profile.hours ?? ""} onChange={(e) => prof("hours", e.target.value)} /></Field>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate/60">Pick the first AI staff. They start as drafts you can test before they go live. Most businesses start with a receptionist.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => {
              const picked = f.staff.find((s) => s.roleKey === r.key);
              const tier = tierFor(r.key);
              return (
                <div key={r.key} className={`rounded-xl border p-3 ${picked ? "border-lagoon bg-lagoon/5" : "border-ink/10"}`}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={!!picked} onChange={() => toggleRole(r.key)} />
                    <span>
                      <span className="text-sm font-semibold text-ink">{r.name}</span>
                      <span className="text-xs text-slate/55"> · {tier.name}, US${tier.monthlyFee}/month</span>
                      <span className="block text-xs text-slate/60">{r.summary}</span>
                    </span>
                  </label>
                  {picked && <input className={`${inputClass} mt-2`} value={picked.name} onChange={(e) => nameRole(r.key, e.target.value)} placeholder={`Name (e.g. Sunny), default ${r.name}`} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <Field label="Website knowledge feed" htmlFor="ob-kurl" hint="Best: a URL on the business's site returning its FAQ as JSON. Wally re-imports it daily, so the site stays the single source of truth.">
            <input id="ob-kurl" className={inputClass} value={f.knowledgeUrl} onChange={(e) => set("knowledgeUrl", e.target.value)} placeholder="https://www.example.com/api/public/knowledge" />
          </Field>
          <Field label="Or paste what the staff should know" htmlFor="ob-know" hint="FAQs, policies, prices guidance. You can add more under Knowledge later.">
            <textarea id="ob-know" rows={6} className={inputClass} value={f.knowledge} onChange={(e) => set("knowledge", e.target.value)} />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={f.introPricing} onChange={(e) => set("introPricing", e.target.checked)} />
            <span>
              <span className="font-semibold text-ink">Create agreements at the introductory price for each role</span>
              <span className="block text-xs text-slate/60">No setup fee. You can change any price under Pricing &amp; Billing.</span>
            </span>
          </label>
          {f.introPricing && f.staff.length > 0 && (
            <ul className="rounded-xl bg-paper p-3 text-xs">
              {f.staff.map((s) => {
                const t = tierFor(s.roleKey);
                return (
                  <li key={s.roleKey} className="flex justify-between py-0.5">
                    <span>{s.name || roles.find((r) => r.key === s.roleKey)?.name} ({t.name})</span>
                    <span className="tabular-nums">US${t.monthlyFee}/month, {t.includedConversations} chats</span>
                  </li>
                );
              })}
              <li className="mt-1 flex justify-between border-t border-ink/8 pt-1 font-semibold text-ink"><span>Total</span><span className="tabular-nums">US${perMonth}/month</span></li>
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {step > 0 && <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}><ChevronLeft className="h-4 w-4" /> Back</Button>}
        {step < STEPS.length - 1 && <Button type="button" variant="secondary" disabled={!f.name.trim()} onClick={() => setStep(step + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>}
        <Button type="button" variant="accent" disabled={pending || !f.name.trim()} onClick={finish}>{pending ? "Setting up…" : "Finish"}</Button>
      </div>
    </Card>
  );
}
