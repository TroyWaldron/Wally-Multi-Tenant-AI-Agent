-- For Wally's health check: any public table without Row Level Security.
-- Callable only with the service role (the console's server side).
create or replace function public.rls_gaps() returns table(table_name text)
language sql stable security definer set search_path = public, pg_catalog as $$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  order by 1;
$$;
revoke all on function public.rls_gaps() from public, anon, authenticated;
grant execute on function public.rls_gaps() to service_role;
