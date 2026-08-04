-- Founder + applicant email notifications for founding clinic applications.
-- Edge function: notify-founding-application (see scripts/setup-founding-notify.sh)

create extension if not exists pg_net with schema extensions;

create table if not exists private.founding_notify_settings (
  id int primary key default 1 check (id = 1),
  edge_function_url text,
  webhook_secret text,
  enabled boolean not null default false
);

revoke all on private.founding_notify_settings from public, anon, authenticated;

create or replace function private.send_founding_notify_webhook(
  p_event text,
  p_application_id uuid,
  p_clinic_name text,
  p_organization_name text,
  p_submitter_email text,
  p_applicant_role text,
  p_website text,
  p_note text,
  p_created_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  settings record;
begin
  select * into settings from private.founding_notify_settings where id = 1;
  if not found or not settings.enabled or settings.edge_function_url is null then
    return;
  end if;

  perform net.http_post(
    url := settings.edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-founding-webhook-secret', coalesce(settings.webhook_secret, '')
    ),
    body := jsonb_build_object(
      'event', p_event,
      'applicationId', p_application_id,
      'clinicName', p_clinic_name,
      'organizationName', p_organization_name,
      'submitterEmail', p_submitter_email,
      'applicantRole', p_applicant_role,
      'website', coalesce(p_website, ''),
      'note', coalesce(p_note, ''),
      'createdAt', coalesce(p_created_at, now())
    )
  );
exception
  when others then
    raise warning 'Founding application notification failed (%): %', p_event, sqlerrm;
end;
$$;

-- Submit application (org owner/admin) — notify founder on new application
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
set search_path = public, private
as $$
declare
  uid uuid := auth.uid();
  app_id uuid;
  founding_count integer;
  max_founding constant integer := 5;
  org_name text;
  submitter_email text;
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

  select o.name into org_name
  from public.organizations o
  where o.id = p_organization_id;

  select p.email into submitter_email
  from public.profiles p
  where p.id = uid;

  perform private.send_founding_notify_webhook(
    'new_application',
    app_id,
    trim(p_clinic_name),
    coalesce(org_name, 'Unknown workspace'),
    coalesce(submitter_email, ''),
    trim(p_applicant_role),
    nullif(trim(coalesce(p_website, '')), ''),
    trim(coalesce(p_note, '')),
    now()
  );

  return app_id;
end;
$$;

-- Approve / reject application — notify applicant
create or replace function public.review_founding_application(
  p_application_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  uid uuid := auth.uid();
  app record;
  founding_count integer;
  max_founding constant integer := 5;
  founding_cents constant integer := 7900;
  org_name text;
  submitter_email text;
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

  select o.name, p.email
  into org_name, submitter_email
  from public.organizations o
  join public.profiles p on p.id = app.submitted_by
  where o.id = app.organization_id;

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

    perform private.send_founding_notify_webhook(
      'approved',
      p_application_id,
      app.clinic_name,
      coalesce(org_name, 'Unknown workspace'),
      coalesce(submitter_email, ''),
      app.applicant_role,
      app.website,
      app.note,
      app.created_at
    );
  else
    update public.founding_applications
    set
      status = 'rejected',
      reviewed_at = now(),
      reviewed_by = uid
    where id = p_application_id;

    perform private.send_founding_notify_webhook(
      'declined',
      p_application_id,
      app.clinic_name,
      coalesce(org_name, 'Unknown workspace'),
      coalesce(submitter_email, ''),
      app.applicant_role,
      app.website,
      app.note,
      app.created_at
    );
  end if;
end;
$$;

create or replace function public.configure_founding_notify(
  p_edge_function_url text,
  p_webhook_secret text,
  p_enabled boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorized.';
  end if;

  insert into private.founding_notify_settings (id, edge_function_url, webhook_secret, enabled)
  values (1, p_edge_function_url, p_webhook_secret, coalesce(p_enabled, true))
  on conflict (id) do update
  set
    edge_function_url = excluded.edge_function_url,
    webhook_secret = excluded.webhook_secret,
    enabled = excluded.enabled;
end;
$$;

grant execute on function public.configure_founding_notify(text, text, boolean) to authenticated;
