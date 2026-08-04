-- 14-day free trial: trial_ends_at on organizations

alter table public.organizations
  add column if not exists trial_ends_at timestamptz;

-- Backfill: 14 days from created_at, or now + 14 days if that window already passed
update public.organizations
set trial_ends_at = case
  when created_at + interval '14 days' > now() then created_at + interval '14 days'
  else now() + interval '14 days'
end
where trial_ends_at is null;

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

  insert into public.organizations (name, plan, is_founding, subscription_status, trial_ends_at)
  values (trim(p_name), 'standard', false, 'trialing', now() + interval '14 days')
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, uid, 'owner');

  return new_org_id;
end;
$$;

grant execute on function public.create_organization(text) to authenticated;
