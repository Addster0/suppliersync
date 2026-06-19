-- Run this entire file once in Supabase SQL Editor

-- 1) Safe org creation (bypasses RLS inside the function)
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(p_name)) = 0 then
    raise exception 'Organization name is required';
  end if;

  if not exists (select 1 from public.profiles where id = uid) then
    insert into public.profiles (id, email, full_name)
    select id, email, coalesce(raw_user_meta_data ->> 'full_name', '')
    from auth.users
    where id = uid;
  end if;

  insert into public.organizations (name)
  values (trim(p_name))
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, uid, 'owner');

  return new_org_id;
end;
$$;

grant execute on function public.create_organization(text) to authenticated;

-- 2) Backup policy so org creation works even before membership exists
drop policy if exists "Authenticated users can read new organizations" on public.organizations;

create policy "Authenticated users can read new organizations"
  on public.organizations for select
  using (
    public.is_org_member(id)
    or not exists (
      select 1
      from public.organization_members om
      where om.organization_id = organizations.id
    )
  );

-- Replace the old members-only select policy
drop policy if exists "Members can read their organizations" on public.organizations;
