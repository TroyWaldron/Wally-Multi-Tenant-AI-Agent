import { redirect } from "next/navigation";
import { WallyMark } from "@/components/WallyMark";
import { getSession } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  if (await getSession()) redirect("/console");
  const mode = isSupabaseConfigured() ? "supabase" : "demo";

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-deep px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl bg-paper p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-2 text-lagoon">
          <WallyMark className="h-8 w-8" />
          <span className="font-heading text-2xl font-bold text-ink">
            Wally<span className="text-amber">.</span>
          </span>
        </div>
        <h1 className="font-heading text-lg font-semibold text-ink">Sign in to the console</h1>
        <p className="mb-6 mt-1 text-sm text-slate/60">
          {mode === "demo" ? "Demo mode: Supabase isn't connected yet, so data lives in memory." : "Manage your AI staff, approvals and settings."}
        </p>
        {expired && <p className="mb-4 rounded-xl bg-amber/15 p-3 text-sm text-ink">That sign-in link was already used or has expired. Sign in below, or ask your admin for a new link.</p>}
        <LoginForm mode={mode} />
      </div>
    </main>
  );
}
