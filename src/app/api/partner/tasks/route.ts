import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { partnerContext } from "@/lib/partnerAuth";
import { chaseDueTasks } from "@/lib/staffDesk";

/** Follow-ups AI staff have set for the team, for the back office to show. Also sends any reminders now due. */
export async function GET(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { store, tenant } = ctx;
  await chaseDueTasks(store, tenant);
  const status = req.nextUrl.searchParams.get("status");
  const [tasks, agents] = await Promise.all([
    store.listTasks(tenant.id, status === "done" || status === "cancelled" || status === "open" ? status : "open"),
    store.listAgents(tenant.id),
  ]);
  return NextResponse.json({
    tasks: tasks.map((t) => ({ ...t, agent: agents.find((a) => a.id === t.agentId)?.name ?? null, overdue: t.status === "open" && new Date(t.dueAt).getTime() < Date.now() })),
  });
}

const Body = z.object({ id: z.string().uuid(), status: z.enum(["open", "done", "cancelled"]), note: z.string().max(500).optional(), by: z.string().max(80).optional() });

/** A person ticks a follow-up off (or reopens it) in the back office. */
export async function POST(req: NextRequest) {
  const ctx = await partnerContext(req);
  if ("error" in ctx) return ctx.error;
  const { store, tenant } = ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { id, status, note?, by? }." }, { status: 400 });
  const { id, status, note, by } = parsed.data;
  const done = status !== "open";
  await store.updateTask(tenant.id, id, { status, doneAt: done ? new Date().toISOString() : null, doneNote: note ?? null });
  await store.audit(tenant.id, { actorType: "user", actor: by ?? "back office", action: `follow_up.${status}`, detail: { taskId: id, note } });
  return NextResponse.json({ ok: true });
}
