-- Letters, Word documents and Excel sheets AI staff create. Files live in the
-- private "documents" storage bucket under <tenant_id>/; links are signed and
-- short-lived.

create table public.agent_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  title text not null,
  kind text not null check (kind in ('letter','word','excel')),
  filename text not null,
  path text not null,
  created_at timestamptz not null default now()
);
create index on public.agent_documents (tenant_id, created_at desc);

alter table public.agent_documents enable row level security;
create policy agent_documents_read on public.agent_documents for select to authenticated
  using (public.can_access_tenant(tenant_id));
create policy agent_documents_write on public.agent_documents for all to authenticated
  using (public.can_manage_tenant(tenant_id)) with check (public.can_manage_tenant(tenant_id));

insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
