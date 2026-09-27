"use client";

// Shared console building blocks, in the Sunsational ops hub style: soft
// white cards, pill statuses, tables with friendly empty states.
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition, type ComponentType, type ReactNode } from "react";
import type { ActionResult } from "@/app/console/actions";

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

export const cardClass = "rounded-2xl border border-ink/8 bg-white shadow-[0_2px_10px_rgba(19,35,58,0.05)]";

export function MetricCard({ icon: I, label, value, hint, accent }: { icon: Icon; label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <div className={`${cardClass} p-5`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate/50">{label}</span>
        <I className={`h-4 w-4 ${accent ? "text-amber" : "text-lagoon"}`} strokeWidth={1.9} />
      </div>
      <div className="mt-2 font-heading text-2xl font-bold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate/50">{hint}</div>}
    </div>
  );
}

export function SectionTitle({ icon: I, children, action }: { icon: Icon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <I className="h-4 w-4 text-amber" strokeWidth={2} />
        <h2 className="font-heading text-lg font-semibold text-ink">{children}</h2>
      </div>
      {action}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`${cardClass} p-5 ${className}`}>
      {title && <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>}
      {children}
    </div>
  );
}

const PILL: Record<string, string> = {
  live: "bg-leaf/15 text-leaf",
  approved: "bg-leaf/15 text-leaf",
  active: "bg-leaf/15 text-leaf",
  ran: "bg-leaf/15 text-leaf",
  open: "bg-lagoon/15 text-lagoon",
  trial: "bg-lagoon/15 text-lagoon",
  draft: "bg-ink/10 text-ink",
  closed: "bg-ink/10 text-ink/70",
  pending: "bg-amber/20 text-[#9a6a12]",
  waiting_human: "bg-amber/20 text-[#9a6a12]",
  sent_for_approval: "bg-amber/20 text-[#9a6a12]",
  paused: "bg-coral/15 text-coral",
  rejected: "bg-coral/15 text-coral",
  denied: "bg-coral/15 text-coral",
  error: "bg-coral/15 text-coral",
  offboarded: "bg-coral/15 text-coral",
};

export function Pill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PILL[status] ?? "bg-ink/10 text-ink"}`}>
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function Table({ columns, rows, empty, minWidth = 640 }: { columns: string[]; rows: ReactNode[][]; empty: string; minWidth?: number }) {
  return (
    <div className={`${cardClass} overflow-x-auto`}>
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead className="bg-ink/[0.035]">
          <tr>
            {columns.map((c, i) => (
              <th key={`${c}-${i}`} className="px-4 py-3 text-xs font-semibold text-ink/70">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate/45">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={i} className="transition hover:bg-paper">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 align-middle text-slate/85">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "accent"; size?: "sm" | "md" }) {
  const v = {
    primary: "bg-ink text-white hover:bg-ink-deep",
    accent: "bg-lagoon text-white hover:bg-lagoon-deep",
    secondary: "border border-ink/15 text-ink hover:bg-ink hover:text-white",
    ghost: "text-ink/70 hover:bg-ink/5",
    danger: "border border-coral/40 text-coral hover:bg-coral hover:text-white",
  }[variant];
  const s = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button {...rest} className={`inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${s} ${className}`}>
      {children}
    </button>
  );
}

export const inputClass = "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2 text-sm text-ink outline-none transition focus:border-lagoon";

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-ink/80">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate/55">{hint}</p>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`${cardClass} flex flex-col items-center gap-2 px-6 py-12 text-center`}>
      <div className="font-heading text-base font-semibold text-ink">{title}</div>
      {children && <p className="max-w-md text-sm text-slate/60">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- toasts */

type Toast = { id: number; ok: boolean; text: string };
const ToastCtx = createContext<(ok: boolean, text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (ok: boolean, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, ok, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${t.ok ? "bg-ink text-white" : "bg-coral text-white"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/** Runs a server action, toasts the result and refreshes the page data. */
export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onOk?: (r: ActionResult & { ok: true }) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast(true, r.message);
        onOk?.(r);
        router.refresh();
      } else toast(false, r.error);
    });
  return { run, pending };
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function money(value: number, currency: string) {
  const sym = currency === "TTD" ? "TT$" : currency === "USD" ? "US$" : `${currency} `;
  return `${sym}${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function usd(value: number) {
  // Single agent replies cost fractions of a cent, so show enough digits to see them.
  if (value > 0 && value < 0.01) return `US$${value.toFixed(4)}`;
  return `US$${value.toFixed(value < 10 ? 2 : 0)}`;
}
