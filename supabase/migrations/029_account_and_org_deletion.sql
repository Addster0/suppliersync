-- Account and workspace deletion RPCs + api_usage_log retention helper.

-- ---------------------------------------------------------------------------
-- delete_organization — owner-only workspace delete (storage cleanup is client-side)
-- ---------------------------------------------------------------------------

create or replace function public.delete_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_org_role(p_org_id, array['owner']::public.org_role[]) then
    raise exception 'Only workspace owners can delete a workspace';
  end if;

  delete from public.organizations where id = p_org_id;
end;
$$;

grant execute on function public.delete_organization(uuid) to authenticated;

comment on function public.delete_organization(uuid) is
  'Deletes a workspace and all tenant data (CASCADE). Call after removing organization-files storage prefix from the client or edge function.';

-- ---------------------------------------------------------------------------
-- delete_my_account — app data cleanup (auth.users removed by delete-account edge function)
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rec record;
  member_count int;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  for rec in
    select om.organization_id
    from public.organization_members om
    where om.user_id = uid
      and om.role = 'owner'
  loop
    select count(*)::int into member_count
    from public.organization_members
    where organization_id = rec.organization_id;

    if member_count > 1 then
      raise exception 'You own a workspace with other members. Transfer ownership or delete that workspace first.';
    end if;
  end loop;

  delete from public.organizations o
  where exists (
    select 1
    from public.organization_members om
    where om.organization_id = o.id
      and om.user_id = uid
      and om.role = 'owner'
  )
  and (
    select count(*)
    from public.organization_members om2
    where om2.organization_id = o.id
  ) = 1;

  delete from public.organization_members where user_id = uid;

  delete from public.profiles where id = uid;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Removes profile, memberships, sole-owner workspaces, and outreach CRM data. Pair with delete-account edge function to remove auth.users.';

-- ---------------------------------------------------------------------------
-- purge_old_api_usage_log — retention helper (schedule via pg_cron or manual)
-- ---------------------------------------------------------------------------

create or replace function public.purge_old_api_usage_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.api_usage_log
  where created_at < now() - interval '7 days';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_old_api_usage_log() from public;
grant execute on function public.purge_old_api_usage_log() to service_role;

comment on function public.purge_old_api_usage_log() is
  'Deletes api_usage_log rows older than 7 days. Schedule daily via pg_cron: select cron.schedule(''purge-api-usage-log'', ''0 3 * * *'', $$select public.purge_old_api_usage_log()$$);';
