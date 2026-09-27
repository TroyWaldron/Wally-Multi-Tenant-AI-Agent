-- What each business pays Wally for its AI staff, per the signed agreement.
-- This is the customer-facing price. What Wally itself pays the model
-- providers stays in usage_events and is never shown to the business.
-- One row per priced item: an AI staff member (agent_id set) or a
-- business-wide line (agent_id null).

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  plan_name text not null,
  currency text not null default 'USD',
  monthly_fee numeric(12,2) not null default 0 check (monthly_fee >= 0),
  included_conversations integer not null default 0 check (included_conversations >= 0),
  overage_rate numeric(12,4) not null default 0 check (overage_rate >= 0),
  setup_fee numeric(12,2) not null default 0 check (setup_fee >= 0),
  starts_on date not null default current_date,
  ends_on date,
  status text not null default 'active' check (status in ('active','ended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.contracts (tenant_id);

alter table public.contracts enable row level security;

-- The business can see its own agreement; only the Wally team sets prices.
create policy contracts_read on public.contracts for select
  using (public.can_access_tenant(tenant_id));
create policy contracts_write on public.contracts for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
