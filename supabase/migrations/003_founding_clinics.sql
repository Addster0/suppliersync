-- Run once in Supabase SQL Editor (after 001 and 002)

-- Founding clinic program: first 5 workspaces get locked $79/mo; new clinics pay standard rate.

alter table public.organizations
  add column if not exists is_founding boolean not null default false,
  add column if not exists locked_monthly_price_cents integer,
  add column if not exists founding_enrolled_at timestamptz;

comment on column public.organizations.is_founding is 'True for the first 5 clinics — price locked while subscribed.';
comment on column public.organizations.locked_monthly_price_cents is 'Grandfathered monthly price in cents (e.g. 7900 = $79).';

-- Backfill up to 5 oldest workspaces as founding (safe if you already have clinics)
with ranked as (
  select id, row_number() over (order by created_at asc) as rn
  from public.organizations
)
update public.organizations o
set
  is_founding = true,
  locked_monthly_price_cents = 7900,
  plan = 'founding',
  founding_enrolled_at = coalesce(o.founding_enrolled_at, now())
from ranked r
where o.id = r.id
  and r.rn <= 5
  and o.is_founding = false;

-- Public status for marketing + billing (slot count only)
create or replace function public.get_founding_program_status()
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  founding_count integer;
  max_slots constant integer := 5;
  founding_cents constant integer := 7900;
  standard_cents constant integer := 11900;
begin
  select count(*)::integer into founding_count
  from public.organizations
  where is_founding = true;

  return json_build_object(
    'max_slots', max_slots,
    'claimed_slots', founding_count,
    'slots_remaining', greatest(0, max_slots - founding_count),
    'founding_price_cents', founding_cents,
    'standard_price_cents', standard_cents
  );
end;
$$;

grant execute on function public.get_founding_program_status() to anon, authenticated;

-- Assign founding vs standard when a workspace is created
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  uid uuid := auth.uid();
  founding_count integer;
  max_founding constant integer := 5;
  founding_cents constant integer := 7900;
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

  select count(*)::integer into founding_count
  from public.organizations
  where is_founding = true;

  if founding_count < max_founding then
    insert into public.organizations (
      name,
      plan,
      is_founding,
      locked_monthly_price_cents,
      founding_enrolled_at
    )
    values (trim(p_name), 'founding', true, founding_cents, now())
    returning id into new_org_id;
  else
    insert into public.organizations (name, plan, is_founding)
    values (trim(p_name), 'standard', false)
    returning id into new_org_id;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, uid, 'owner');

  return new_org_id;
end;
$$;

grant execute on function public.create_organization(text) to authenticated;
