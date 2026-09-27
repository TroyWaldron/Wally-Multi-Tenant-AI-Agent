-- Persona versions and A/B tests. Every change to an agent's persona
-- (instructions, tone, title) is kept as a version that can be restored.
-- An agent can split live chats between its current persona (A) and a saved
-- version (B); each chat remembers which one it got.

create table public.agent_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  snapshot jsonb not null,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);
create index on public.agent_versions (tenant_id, agent_id, created_at desc);

alter table public.agent_versions enable row level security;
create policy agent_versions_read on public.agent_versions for select to authenticated
  using (public.can_access_tenant(tenant_id));
create policy agent_versions_write on public.agent_versions for all to authenticated
  using (public.can_manage_tenant(tenant_id)) with check (public.can_manage_tenant(tenant_id));

-- { versionId, share (percent of new chats that get B), startedAt } or null.
alter table public.agents add column experiment jsonb;
-- 'A' or 'B' while the agent was running an experiment, else null.
alter table public.conversations add column variant text check (variant in ('A','B'));
