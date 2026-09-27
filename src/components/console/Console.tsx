"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  Bot,
  Building2,
  ClipboardCheck,
  Inbox,
  LayoutGrid,
  Library,
  Map,
  LifeBuoy,
  Menu,
  MessageSquareText,
  Plug,
  ScrollText,
  Settings as SettingsIcon,
  BookOpen,
  LogOut,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { WallyMark } from "@/components/WallyMark";
import type { ModelInfo } from "@/lib/agent/models";
import type { SettingStatus } from "@/lib/settings";
import type { Agent, Approval, AuditEntry, Channel, Conversation, KnowledgeDoc, OutcomeEvent, RoleTemplate, Tenant, UsageEvent } from "@/lib/types";
import { ToastProvider } from "./ui";
import { DashboardView } from "./views/Dashboard";
import { AgentsView } from "./views/Agents";
import { PlaygroundView } from "./views/Playground";
import { ApprovalsView } from "./views/Approvals";
import { HelpdeskView } from "./views/Helpdesk";
import { ConversationsView } from "./views/Conversations";
import { KnowledgeView } from "./views/Knowledge";
import { OutcomesView } from "./views/Outcomes";
import { RolesView } from "./views/Roles";
import { ChannelsView } from "./views/Channels";
import { AuditView } from "./views/Audit";
import { BusinessView } from "./views/Business";
import { RoadmapView } from "./views/Roadmap";
import { SettingsView } from "./views/Settings";

type Base = {
  /** Request time (ms), so every view agrees on "now". */
  now: number;
  /** This deployment's public URL, for embed snippets and webhook URLs. */
  origin: string;
  mode: "demo" | "supabase";
  user: { id: string; email: string };
  isPlatformAdmin: boolean;
  tenants: Pick<Tenant, "id" | "name" | "slug" | "status">[];
  roles: RoleTemplate[];
  models: ModelInfo[];
  n8nEvents: { event: string; when: string }[];
};

export type TenantData = Base & {
  tenant: Tenant;
  agents: Agent[];
  conversations: Conversation[];
  helpdesk: Conversation[];
  approvals: Approval[];
  audit: AuditEntry[];
  outcomes: OutcomeEvent[];
  usage: UsageEvent[];
  knowledge: KnowledgeDoc[];
  channels: Channel[];
  settings: SettingStatus[];
  monthStart: string;
};

export type ConsoleData = (Base & { tenant: null }) | TenantData;

export type ViewId =
  | "dashboard"
  | "agents"
  | "playground"
  | "approvals"
  | "conversations"
  | "helpdesk"
  | "knowledge"
  | "outcomes"
  | "roles"
  | "channels"
  | "audit"
  | "business"
  | "roadmap"
  | "settings";

export function Console({ data }: { data: ConsoleData }) {
  return (
    <ToastProvider>
      <Shell data={data} />
    </ToastProvider>
  );
}

function Shell({ data }: { data: ConsoleData }) {
  const router = useRouter();
  const [view, setView] = useState<ViewId>(data.tenant ? "dashboard" : "business");
  const [open, setOpen] = useState(false);
  const [playAgent, setPlayAgent] = useState<string | null>(null);

  const d = data.tenant ? (data as TenantData) : null;
  const pending = d?.approvals.filter((a) => a.status === "pending").length ?? 0;
  const waiting = d?.conversations.filter((c) => c.status === "waiting_human").length ?? 0;
  const helpWaiting = d?.helpdesk.filter((c) => c.status === "waiting_human").length ?? 0;

  const NAV: { group: string; items: { id: ViewId; label: string; icon: typeof LayoutGrid; badge?: number; needsTenant?: boolean }[] }[] = [
    {
      group: "Run",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutGrid, needsTenant: true },
        { id: "approvals", label: "Approvals", icon: ClipboardCheck, badge: pending, needsTenant: true },
        { id: "conversations", label: "Conversations", icon: Inbox, badge: waiting, needsTenant: true },
        { id: "playground", label: "Playground", icon: MessageSquareText, needsTenant: true },
      ],
    },
    {
      group: "Build",
      items: [
        { id: "agents", label: "Agents", icon: Bot, needsTenant: true },
        { id: "knowledge", label: "Knowledge", icon: BookOpen, needsTenant: true },
        { id: "channels", label: "Channels & Embed", icon: Plug, needsTenant: true },
        { id: "roles", label: "Role Library", icon: Library },
      ],
    },
    {
      group: "Measure",
      items: [
        { id: "outcomes", label: "Outcomes & Spend", icon: BarChart3, needsTenant: true },
        { id: "audit", label: "Audit Log", icon: ScrollText, needsTenant: true },
      ],
    },
    {
      group: "Admin",
      items: [
        { id: "business", label: "Business", icon: Building2 },
        { id: "helpdesk", label: "Helpdesk", icon: LifeBuoy, badge: helpWaiting, needsTenant: true },
        { id: "roadmap", label: "Roadmap", icon: Map },
        { id: "settings", label: "Settings", icon: SettingsIcon, needsTenant: true },
      ],
    },
  ];

  const all = NAV.flatMap((g) => g.items);
  const current = all.find((n) => n.id === view) ?? all[0];
  const go = (id: ViewId) => {
    setView(id);
    setOpen(false);
  };
  const openPlayground = (agentId: string) => {
    setPlayAgent(agentId);
    go("playground");
  };

  return (
    <div className="min-h-screen bg-paper">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto bg-ink-deep transition-transform duration-300 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="border-b border-white/5 px-6 pb-5 pt-6">
          <div className="flex items-center gap-2 text-lagoon">
            <WallyMark className="h-7 w-7" />
            <span className="font-heading text-xl font-bold text-white">
              Wally<span className="text-amber">.</span>
            </span>
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/35">AI staff console</div>
        </div>

        <div className="border-b border-white/5 px-6 py-4">
          <label htmlFor="tenant-switch" className="text-[10px] uppercase tracking-[0.15em] text-white/35">
            Business
          </label>
          {data.tenants.length ? (
            <select
              id="tenant-switch"
              value={data.tenant?.slug ?? ""}
              onChange={(e) => router.push(`/console?t=${e.target.value}`)}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white outline-none"
            >
              {data.tenants.map((t) => (
                <option key={t.id} value={t.slug} className="text-ink">
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-1.5 text-sm text-white/60">None yet</div>
          )}
        </div>

        <nav className="flex-1 py-3 pr-3">
          {NAV.map((g) => (
            <div key={g.group} className="mb-2">
              <div className="px-6 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/25">{g.group}</div>
              <ul>
                {g.items.map((item) => {
                  const disabled = item.needsTenant && !data.tenant;
                  const active = item.id === view;
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => go(item.id)}
                        disabled={disabled}
                        className={`flex w-full items-center gap-3 rounded-r-full px-6 py-2 text-sm font-medium transition disabled:opacity-30 ${
                          active ? "bg-white/10 text-amber" : "text-white/60 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                        <span className="truncate">{item.label}</span>
                        {item.badge ? <span className="ml-auto rounded-full bg-amber px-2 py-0.5 text-[10px] font-bold text-ink-deep">{item.badge}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-3 border-t border-white/5 px-6 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber text-xs font-bold text-ink-deep">{data.user.email.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-white">{data.user.email}</div>
            <div className="text-[10px] uppercase tracking-wide text-amber-light/70">{data.isPlatformAdmin ? "Platform admin" : "Member"}</div>
          </div>
          <form action={logout}>
            <button className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-ink-deep/60 lg:hidden" onClick={() => setOpen(false)} />}

      <main className="lg:ml-64">
        {data.mode === "demo" && (
          <div className="bg-amber/20 px-5 py-2 text-center text-xs font-medium text-[#7a5410] sm:px-8">
            Demo mode: Supabase isn&apos;t connected, so changes live in memory and reset on restart. Sample data is marked.
          </div>
        )}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/5 bg-paper/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen((v) => !v)} className="rounded-lg p-1.5 text-ink lg:hidden" aria-label="Toggle menu">
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="font-heading text-2xl font-bold text-ink">{current.label}</h1>
          </div>
          {data.tenant && (
            <div className="flex items-center gap-2 text-xs text-slate/60">
              <Activity className="h-3.5 w-3.5 text-lagoon" />
              {data.tenant.name}
            </div>
          )}
        </header>

        <div className="px-5 py-8 sm:px-8">
          {d && view === "dashboard" && <DashboardView data={d} onNavigate={go} />}
          {d && view === "agents" && <AgentsView data={d} onTest={openPlayground} />}
          {d && view === "playground" && <PlaygroundView data={d} initialAgentId={playAgent} />}
          {d && view === "approvals" && <ApprovalsView data={d} />}
          {d && view === "conversations" && <ConversationsView data={d} />}
          {d && view === "helpdesk" && <HelpdeskView data={d} />}
          {d && view === "knowledge" && <KnowledgeView data={d} />}
          {d && view === "outcomes" && <OutcomesView data={d} />}
          {view === "roles" && <RolesView roles={data.roles} tenantId={data.tenant?.id ?? null} onHired={() => go("agents")} />}
          {d && view === "channels" && <ChannelsView data={d} />}
          {d && view === "audit" && <AuditView data={d} />}
          {view === "business" && <BusinessView data={data} />}
          {view === "roadmap" && <RoadmapView />}
          {d && view === "settings" && <SettingsView data={d} />}
        </div>
      </main>
    </div>
  );
}
