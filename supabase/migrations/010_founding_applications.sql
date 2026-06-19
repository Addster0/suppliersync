-- Founding clinic applications (manual approval before founding rate)
-- Also: new workspaces no longer auto-receive founding slots.

-- Helper functions FIRST (policies reference these)
create or replace function public.is_org_admin(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = org_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

grant execute on function public.is_org_admin(uuid) to authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(p.email) in ('addstero28@gmail.com')
  );
$$;

grant execute on function public.is_platform_admin() to authenticated;

create table if not exists public.founding_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  submitted_by uuid not null references auth.users (id) on delete cascade,
  clinic_name text not null,
  website text,
  applicant_role text not null,
  note text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (organization_id)
);

create index if not exists founding_applications_status_idx
  on public.founding_applications (status);

alter table public.founding_applications enable row level security;

drop policy if exists "Org members can read their founding application" on public.founding_applications;

create policy "Org members can read their founding application"
  on public.founding_applications for select
  using (public.is_org_member(organization_id));

drop policy if exists "Org admins can insert founding application" on public.founding_applications;

create policy "Org admins can insert founding application"
  on public.founding_applications for insert
  with check (
    public.is_org_admin(organization_id)
    and submitted_by = auth.uid()
  );

drop policy if exists "Platform admin can read all founding applications" on public.founding_applications;

create policy "Platform admin can read all founding applications"
  on public.founding_applications for select
  using (public.is_platform_admin());

drop policy if exists "Platform admin can update founding applications" on public.founding_applications;

create policy "Platform admin can update founding applications"
  on public.founding_applications for update
  using (public.is_platform_admin());

-- Submit application (org owner/admin)
create or replace function public.submit_founding_application(
  p_organization_id uuid,
  p_clinic_name text,
  p_website text,
  p_applicant_role text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  app_id uuid;
  founding_count integer;
  max_founding constant integer := 5;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_org_admin(p_organization_id) then
    raise exception 'Only workspace owners and admins can apply.';
  end if;

  if exists (
    select 1 from public.organizations
    where id = p_organization_id and is_founding = true
  ) then
    raise exception 'This workspace already has founding pricing.';
  end if;

  if exists (
    select 1 from public.founding_applications
    where organization_id = p_organization_id and status = 'approved'
  ) then
    raise exception 'This workspace was already approved for founding pricing.';
  end if;

  delete from public.founding_applications
  where organization_id = p_organization_id and status = 'rejected';

  if exists (
    select 1 from public.founding_applications
    where organization_id = p_organization_id and status = 'pending'
  ) then
    raise exception 'You already have a pending application.';
  end if;

  select count(*)::integer into founding_count
  from public.organizations
  where is_founding = true;

  if founding_count >= max_founding then
    raise exception 'All founding slots are currently claimed.';
  end if;

  insert into public.founding_applications (
    organization_id,
    submitted_by,
    clinic_name,
    website,
    applicant_role,
    note,
    status
  )
  values (
    p_organization_id,
    uid,
    trim(p_clinic_name),
    nullif(trim(coalesce(p_website, '')), ''),
    trim(p_applicant_role),
    trim(coalesce(p_note, '')),
    'pending'
  )
  returning id into app_id;

  return app_id;
end;
$$;

grant execute on function public.submit_founding_application(uuid, text, text, text, text) to authenticated;

-- Approve application (platform admin)
create or replace function public.review_founding_application(
  p_application_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  app record;
  founding_count integer;
  max_founding constant integer := 5;
  founding_cents constant integer := 7900;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Not authorized.';
  end if;

  select * into app
  from public.founding_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'Application not found.';
  end if;

  if app.status <> 'pending' then
    raise exception 'Application was already reviewed.';
  end if;

  if p_approve then
    select count(*)::integer into founding_count
    from public.organizations
    where is_founding = true;

    if founding_count >= max_founding then
      raise exception 'No founding slots remaining.';
    end if;

    update public.organizations
    set
      is_founding = true,
      locked_monthly_price_cents = founding_cents,
      plan = 'founding',
      founding_enrolled_at = coalesce(founding_enrolled_at, now())
    where id = app.organization_id;

    update public.founding_applications
    set
      status = 'approved',
      reviewed_at = now(),
      reviewed_by = uid
    where id = p_application_id;
  else
    update public.founding_applications
    set
      status = 'rejected',
      reviewed_at = now(),
      reviewed_by = uid
    where id = p_application_id;
  end if;
end;
$$;

grant execute on function public.review_founding_application(uuid, boolean) to authenticated;

-- New workspaces always start on standard plan (founding via application only)
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

  insert into public.organizations (name, plan, is_founding)
  values (trim(p_name), 'standard', false)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, uid, 'owner');

  return new_org_id;
end;
$$;

grant execute on function public.create_organization(text) to authenticated;

-- Admin list (platform admin only)
create or replace function public.list_pending_founding_applications()
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  clinic_name text,
  website text,
  applicant_role text,
  note text,
  submitter_email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorized.';
  end if;

  return query
  select
    fa.id,
    fa.organization_id,
    o.name as organization_name,
    fa.clinic_name,
    fa.website,
    fa.applicant_role,
    fa.note,
    p.email as submitter_email,
    fa.created_at
  from public.founding_applications fa
  join public.organizations o on o.id = fa.organization_id
  join public.profiles p on p.id = fa.submitted_by
  where fa.status = 'pending'
  order by fa.created_at asc;
end;
$$;

grant execute on function public.list_pending_founding_applications() to authenticated;

create or replace function public.is_platform_admin_for_client()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_platform_admin();
$$;

grant execute on function public.is_platform_admin_for_client() to authenticated;
