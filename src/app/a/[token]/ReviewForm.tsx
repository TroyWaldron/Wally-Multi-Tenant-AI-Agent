"use client";

import { useActionState, useState } from "react";
import { decideFromLink, type LinkResult } from "./actions";

export function ReviewForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<LinkResult, FormData>(decideFromLink.bind(null, token), null);
  const [declining, setDeclining] = useState(false);
  if (state?.ok) return <p className="mt-6 rounded-xl bg-lagoon/10 p-3 text-sm font-medium text-lagoon-deep">{state.message}</p>;

  const input = "w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink";
  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      <label className="text-xs font-semibold text-ink/70">
        Your name
        <input name="name" required maxLength={60} autoComplete="name" className={`mt-1 ${input}`} />
      </label>
      {declining && (
        <label className="text-xs font-semibold text-ink/70">
          Why not? (optional; the AI will follow this from now on)
          <input name="reason" maxLength={200} className={`mt-1 ${input}`} />
        </label>
      )}
      {state && !state.ok && <p className="text-sm text-coral">{state.message}</p>}
      <div className="flex gap-2">
        {declining ? (
          <button name="decision" value="rejected" disabled={pending} className="flex-1 rounded-xl bg-coral px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Decline</button>
        ) : (
          <>
            <button name="decision" value="approved" disabled={pending} className="flex-1 rounded-xl bg-lagoon px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Approve</button>
            <button type="button" onClick={() => setDeclining(true)} className="flex-1 rounded-xl border border-ink/15 px-4 py-2.5 text-sm font-semibold text-ink">Decline</button>
          </>
        )}
      </div>
    </form>
  );
}
