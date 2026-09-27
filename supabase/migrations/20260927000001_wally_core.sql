-- Wally core schema (Phase 0).
--
-- Tenancy: platform -> agencies -> tenants -> agents. Every business row
-- carries tenant_id and is protected by Row Level Security. The browser only
-- ever holds a user JWT; the service role is used server-side for webhooks
-- and the widget, and those code paths always pass an explicit tenant_id
-- (see src/lib/store/supabase.ts, the "phantom tenant guard").

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ------------------------------------------------------------ tenancy

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references public.agencies(id) on delete set null,
  name text not null,
  slug text not null unique,
  industry text,
  country text default 'TT',
  timezone text not null default 'America/Port_of_Spain',
  currency text not null default 'TTD',
  status text not null default 'trial' check (status in ('trial','active','paused','offboarded')),
  -- Public key carried by the website widget script tag. Not a secret: it
  -- only identifies the tenant; the gateway decides what it may do.
  public_key text not null unique default 'wk_' || encode(gen_random_bytes(12), 'hex'),
  profile jsonb not null default '{}'::jsonb,   -- about, hours, address, phone, website
  branding jsonb not null default '{}'::jsonb,  -- color, avatar, welcome, widget position
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  agency_id uuid references public.agencies(id) on delete cascade,
  role text not null check (role in ('platform_admin','agency_admin','tenant_admin','tenant_staff')),
  created_at timestamptz not null default now(),
  check (role = 'platform_admin' or tenant_id is not null or agency_id is not null)
);
create index on public.memberships (user_id);

-- ------------------------------------------------------------ access helpers
-- SECURITY DEFINER so policies can read memberships without recursing into
-- the memberships table's own RLS.

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and role = 'platform_admin');
$$;

create or replace function public.can_access_tenant(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select t is not null and (
    public.is_platform_admin()
    or exists (select 1 from memberships m where m.user_id = auth.uid() and m.tenant_id = t)
    or exists (
      select 1 from memberships m join tenants tn on tn.agency_id = m.agency_id
      where m.user_id = auth.uid() and m.role = 'agency_admin' and tn.id = t
    )
  );
$$;

create or replace function public.can_manage_tenant(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select t is not null and (
    public.is_platform_admin()
    or exists (select 1 from memberships m where m.user_id = auth.uid() and m.tenant_id = t and m.role = 'tenant_admin')
    or exists (
      select 1 from memberships m join tenants tn on tn.agency_id = m.agency_id
      where m.user_id = auth.uid() and m.role = 'agency_admin' and tn.id = t
    )
  );
$$;

-- ------------------------------------------------------------ agents

create table public.role_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade, -- null = platform library
  key text not null,
  name text not null,
  category text not null,
  summary text not null,
  system_prompt text not null,
  default_boundaries jsonb not null default '{}'::jsonb,
  default_personality jsonb not null default '{}'::jsonb,
  voice_enabled boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, key, version)
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_key text not null,
  name text not null,
  title text,
  avatar text,
  status text not null default 'draft' check (status in ('draft','live','paused')),
  model text not null default 'claude-opus-5',
  fallback_model text default 'claude-haiku-4-5',
  effort text not null default 'medium',
  instructions text not null default '',
  personality jsonb not null default '{}'::jsonb,
  boundaries jsonb not null default '{}'::jsonb,
  channels text[] not null default array['playground']::text[],
  voice jsonb not null default '{}'::jsonb,
  monthly_budget_usd numeric(10,2) not null default 25,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.agents (tenant_id);

-- External identities routed to a tenant: WhatsApp phone_number_id, email
-- inbox, Slack team, phone number. This is the global router Chatwoot lacks:
-- one Meta app, many client numbers.
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  kind text not null check (kind in ('web','whatsapp','email','slack','teams','phone','sms','webhook')),
  external_id text not null,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, external_id)
);

-- ------------------------------------------------------------ conversations

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  channel text not null,
  contact jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','waiting_human','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.conversations (tenant_id, updated_at desc);

create table public.messages (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool','system','staff')),
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.messages (conversation_id, id);

-- ------------------------------------------------------------ trust layer

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  kind text not null default 'action' check (kind in ('action','escalation')),
  action text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.approvals (tenant_id, status, created_at desc);

-- Immutable: no UPDATE or DELETE, enforced by trigger for every role.
create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_type text not null check (actor_type in ('agent','user','system','n8n','widget')),
  actor text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log (tenant_id, id desc);

create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- ------------------------------------------------------------ outcomes & usage

create table public.outcome_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  kind text not null,          -- lead, booking, ticket_closed, record_processed, call_handled ...
  value numeric(12,2) not null default 0,
  currency text not null default 'TTD',
  note text,
  created_at timestamptz not null default now()
);
create index on public.outcome_events (tenant_id, created_at desc);

create table public.usage_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  kind text not null check (kind in ('llm','voice_stt','voice_tts','telephony','tool')),
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  minutes numeric(10,2) not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index on public.usage_events (tenant_id, created_at desc);

-- ------------------------------------------------------------ knowledge

create table public.knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  source text not null default 'manual',
  content text not null,
  -- Per-tenant vector namespace: rows are always filtered by tenant_id.
  embedding vector(1024),
  fts tsvector generated always as (to_tsvector('english', title || ' ' || content)) stored,
  created_at timestamptz not null default now()
);
create index on public.knowledge_docs using gin (fts);
create index on public.knowledge_docs (tenant_id);

create or replace function public.search_knowledge(p_tenant uuid, p_query text, p_limit int default 4)
returns table (id uuid, title text, content text, rank real)
language sql stable as $$
  select d.id, d.title, d.content, ts_rank(d.fts, websearch_to_tsquery('english', p_query)) as rank
  from public.knowledge_docs d
  where d.tenant_id = p_tenant
    and d.fts @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

-- ------------------------------------------------------------ settings
-- Integration settings (n8n URL and secret, WhatsApp tokens). Service role
-- only: RLS is on with no policies, so the browser can never read a secret.

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade, -- null = platform-wide
  key text not null,
  value text not null,
  secret boolean not null default false,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, key)
);

-- ------------------------------------------------------------ RLS

alter table public.agencies enable row level security;
alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.role_templates enable row level security;
alter table public.agents enable row level security;
alter table public.channels enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.approvals enable row level security;
alter table public.audit_log enable row level security;
alter table public.outcome_events enable row level security;
alter table public.usage_events enable row level security;
alter table public.knowledge_docs enable row level security;
alter table public.settings enable row level security;

create policy agencies_read on public.agencies for select to authenticated
  using (public.is_platform_admin() or exists (select 1 from memberships m where m.user_id = auth.uid() and m.agency_id = agencies.id));
create policy agencies_admin on public.agencies for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy tenants_read on public.tenants for select to authenticated using (public.can_access_tenant(id));
create policy tenants_update on public.tenants for update to authenticated using (public.can_manage_tenant(id)) with check (public.can_manage_tenant(id));
create policy tenants_insert on public.tenants for insert to authenticated with check (public.is_platform_admin());
create policy tenants_delete on public.tenants for delete to authenticated using (public.is_platform_admin());

create policy memberships_self on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin() or public.can_manage_tenant(tenant_id));
create policy memberships_admin on public.memberships for all to authenticated
  using (public.is_platform_admin() or public.can_manage_tenant(tenant_id))
  with check (public.is_platform_admin() or (role <> 'platform_admin' and public.can_manage_tenant(tenant_id)));

create policy templates_read on public.role_templates for select to authenticated
  using (tenant_id is null or public.can_access_tenant(tenant_id));
create policy templates_write on public.role_templates for all to authenticated
  using (case when tenant_id is null then public.is_platform_admin() else public.can_manage_tenant(tenant_id) end)
  with check (case when tenant_id is null then public.is_platform_admin() else public.can_manage_tenant(tenant_id) end);

-- Tenant-scoped tables: members read, managers write.
do $$
declare t text;
begin
  foreach t in array array['agents','channels','knowledge_docs'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.can_access_tenant(tenant_id))', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (public.can_manage_tenant(tenant_id)) with check (public.can_manage_tenant(tenant_id))', t);
  end loop;
  -- Operational tables: any member can read and act (staff decide approvals, reply to guests).
  foreach t in array array['conversations','messages','approvals'] loop
    execute format('create policy %1$s_rw on public.%1$s for all to authenticated using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id))', t);
  end loop;
  -- Append-only / metering tables: members read and insert.
  foreach t in array array['audit_log','outcome_events','usage_events'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.can_access_tenant(tenant_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.can_access_tenant(tenant_id))', t);
  end loop;
end $$;
