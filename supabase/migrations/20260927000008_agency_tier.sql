-- Agency tier: resellers (Novate first) who white-label Wally, onboard their
-- own client businesses and keep a share of each client's price.

alter table public.agencies
  add column if not exists margin_pct numeric not null default 20 check (margin_pct >= 0 and margin_pct <= 90),
  add column if not exists support_email text;

-- Agency admins are invited by email; the membership is created the first
-- time that person signs in (no email is sent by Wally).
create table public.agency_invites (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  email text not null,
  invited_by text,
  created_at timestamptz not null default now(),
  unique (agency_id, email)
);
alter table public.agency_invites enable row level security;
create policy agency_invites_admin on public.agency_invites for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create or replace function public.is_agency_admin(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a is not null and exists (
    select 1 from memberships where user_id = auth.uid() and agency_id = a and role = 'agency_admin'
  );
$$;
revoke execute on function public.is_agency_admin(uuid) from anon, public;
grant execute on function public.is_agency_admin(uuid) to authenticated, service_role;

-- Agency admins may add businesses, but only under their own agency.
drop policy if exists tenants_insert on public.tenants;
create policy tenants_insert on public.tenants for insert to authenticated
  with check (public.is_platform_admin() or public.is_agency_admin(agency_id));
