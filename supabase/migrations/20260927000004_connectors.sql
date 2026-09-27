-- Connectors: a business's own systems, reached over MCP (Model Context
-- Protocol, streamable HTTP). Each connector lists which AI staff may use it
-- and which of its tools need a person's approval first. Tokens live in the
-- settings table (key MCP_TOKEN_<connector id>), never in this row.

create table public.connectors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  url text not null,
  -- none | bearer (token saved in settings) | relay_secret (the business's WIDGET_RELAY_SECRET)
  auth text not null default 'none' check (auth in ('none','bearer','relay_secret')),
  agent_ids uuid[] not null default '{}',
  allowed_tools text[] not null default '{}',
  approval_tools text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.connectors (tenant_id);

alter table public.connectors enable row level security;

create policy connectors_read on public.connectors for select
  using (public.can_access_tenant(tenant_id));
create policy connectors_write on public.connectors for all
  using (public.is_platform_admin() or public.can_manage_tenant(tenant_id))
  with check (public.is_platform_admin() or public.can_manage_tenant(tenant_id));
