-- Security advisor fixes: pin search_path on the two unpinned functions and
-- stop anonymous callers from reaching the tenancy helpers over /rest/v1/rpc.
-- Every RLS policy targets `authenticated`, so anon never needs these.
alter function public.audit_log_immutable() set search_path = public;
alter function public.search_knowledge(uuid, text, int) set search_path = public;

revoke execute on function public.can_access_tenant(uuid) from anon, public;
revoke execute on function public.can_manage_tenant(uuid) from anon, public;
revoke execute on function public.is_platform_admin() from anon, public;
grant execute on function public.can_access_tenant(uuid) to authenticated, service_role;
grant execute on function public.can_manage_tenant(uuid) to authenticated, service_role;
grant execute on function public.is_platform_admin() to authenticated, service_role;
