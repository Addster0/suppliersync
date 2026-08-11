-- Fix ambiguous "endpoint" in check_and_log_api_usage (PL/pgSQL variable vs column name).

create or replace function public.check_and_log_api_usage(
  p_org_id uuid,
  p_endpoint text,
  p_max_per_hour int default 30
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  recent_count int;
  v_endpoint text := trim(p_endpoint);
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'Not authorized';
  end if;

  if v_endpoint is null or length(v_endpoint) = 0 then
    raise exception 'endpoint is required';
  end if;

  select count(*)::int into recent_count
  from public.api_usage_log
  where organization_id = p_org_id
    and api_usage_log.endpoint = v_endpoint
    and created_at > now() - interval '1 hour';

  if recent_count >= p_max_per_hour then
    raise exception 'Rate limit exceeded: % AI extractions per hour for this workspace. Try again later.', p_max_per_hour;
  end if;

  insert into public.api_usage_log (organization_id, endpoint, user_id)
  values (p_org_id, v_endpoint, uid);
end;
$$;

grant execute on function public.check_and_log_api_usage(uuid, text, int) to authenticated;
