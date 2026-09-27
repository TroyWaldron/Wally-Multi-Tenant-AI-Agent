-- Follow-ups and reminders that AI staff (a coordinator, an accountant) set
-- for the business's people. Wally chases them when they fall due and tells
-- managers when one is ignored.

create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null,
  detail text,
  -- A person's name, or 'managers' for the business's managers.
  assignee text not null,
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  chase_count int not null default 0,
  last_chased_at timestamptz,
  done_at timestamptz,
  done_note text,
  created_at timestamptz not null default now()
);
create index on public.agent_tasks (tenant_id, status, due_at);

alter table public.agent_tasks enable row level security;
create policy agent_tasks_read on public.agent_tasks for select to authenticated
  using (public.can_access_tenant(tenant_id));
create policy agent_tasks_write on public.agent_tasks for all to authenticated
  using (public.can_manage_tenant(tenant_id)) with check (public.can_manage_tenant(tenant_id));
