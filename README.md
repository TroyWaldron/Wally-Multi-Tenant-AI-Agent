# Wally

Leased AI staff for small businesses. A business "hires" a receptionist,
accountant, coordinator or any of 13 roles; each agent works on the website,
WhatsApp and (later) the phone, inside decision boundaries the owner sets,
with every action logged and every sensitive action sent for approval.

Client zero is **Sunsational Tobago**. Novate Solutions is the agency that
sells it. The full concept and roadmap live in the console under **Roadmap**
and in the [concept review](https://claude.ai/artifact/R57owMEKTyAsDtuuzqCaC3).

## Stack

- **Next.js 16** (App Router) + Tailwind v4, deployed on **Vercel**
- **Supabase** Postgres with Row Level Security on every table, Supabase Auth
- **Claude API** for the agent runtime, with per-agent model, fallback and budget
- **n8n** for delivery and integrations (WhatsApp sends, owner alerts,
  Sunsational availability and enquiries)

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase keys the app runs in **demo
mode**: data lives in memory, seeded with Sunsational Tobago, three agents
and its FAQ. Add `ANTHROPIC_API_KEY` to `.env.local` (or in Settings) and the
agents answer for real in the Playground.

## Go live

See [docs/SETUP.md](docs/SETUP.md) for the Supabase, Vercel, n8n and
WhatsApp steps.

## Map of the code

| Path | What it is |
| --- | --- |
| `supabase/migrations/` | Schema, RLS policies, append-only audit log, knowledge search |
| `src/lib/roles.ts` | The role library: prompts, default boundaries and personalities |
| `src/lib/agent/runtime.ts` | Agent loop: tools, model fallback, usage metering |
| `src/lib/agent/policy.ts` | Decision boundaries checked before every tool call |
| `src/lib/agent/inbound.ts` | One pipeline for every channel |
| `src/lib/store/` | Data access (Supabase and in-memory demo), with the phantom tenant guard |
| `src/app/api/webhooks/` | n8n inbound and the global WhatsApp router |
| `src/app/api/widget/` + `public/widget.js` | The one-line website widget |
| `src/components/console/` | The admin console |
| `n8n/` | Importable n8n workflows |
