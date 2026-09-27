"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ mode }: { mode: "demo" | "supabase" }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  if (state.sent) {
    return <p className="rounded-xl bg-lagoon/10 p-4 text-sm text-lagoon-deep">Check your email for a sign-in link.</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {mode === "supabase" && (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Email
          <input id="email" name="email" type="email" autoComplete="email" required className="rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-lagoon" />
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        {mode === "demo" ? "Admin password" : "Password"}
        <input id="password" name="password" type="password" autoComplete="current-password" className="rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-lagoon" />
      </label>
      {state.error && <p className="text-sm text-coral">{state.error}</p>}
      <button name="intent" value="password" disabled={pending} className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-deep disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {mode === "supabase" && (
        <button name="intent" value="link" formNoValidate disabled={pending} className="text-sm font-medium text-lagoon hover:underline">
          Email me a sign-in link instead
        </button>
      )}
    </form>
  );
}
