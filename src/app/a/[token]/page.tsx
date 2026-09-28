import { WallyMark } from "@/components/WallyMark";
import { readApprovalToken } from "@/lib/approvalLinks";
import { systemStore } from "@/lib/session";
import { ReviewForm } from "./ReviewForm";
import { editableOf } from "@/lib/draftText";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review a request · Wally", robots: { index: false } };

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = readApprovalToken(token);
  const store = systemStore();
  const tenant = t ? await store.getTenant(t.tenantId) : null;
  const approval = tenant && t ? (await store.listApprovals(tenant.id)).find((a) => a.id === t.approvalId) : undefined;
  const agent = approval?.agentId && tenant ? (await store.listAgents(tenant.id)).find((a) => a.id === approval.agentId) : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-deep px-4 py-10">
      <div className="w-full max-w-md rounded-3xl bg-paper p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-2 text-lagoon">
          <WallyMark className="h-7 w-7" />
          <span className="font-heading text-xl font-bold text-ink">{tenant?.name ?? "Wally"}</span>
        </div>
        {!approval ? (
          <p className="text-sm text-slate/70">This link has expired or the request no longer exists. Open Approvals in the Wally console instead.</p>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-lagoon">{agent ? `${agent.name} is asking` : "Approval needed"}</p>
            <h1 className="mt-1 font-heading text-lg font-semibold text-ink">{approval.summary}</h1>
            <p className="mt-1 text-xs text-slate/60">Asked {new Date(approval.createdAt).toLocaleString("en-GB", { timeZone: tenant?.timezone, dateStyle: "medium", timeStyle: "short" })}</p>
            {approval.status === "pending" ? (
              <ReviewForm token={token} draft={editableOf(approval)} />
            ) : (
              <p className="mt-6 rounded-xl bg-ink/5 p-3 text-sm text-ink">
                Already {approval.status} by {approval.decidedBy ?? "someone"}.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
