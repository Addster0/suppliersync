-- Prevent org owners/admins from self-assigning founding or locked pricing.
-- Extends 021 billing-field protection. service_role (webhooks) and trusted
-- security-definer RPCs (review_founding_application) may update pricing columns.

-- Same column as 013/025; idempotent if 025 already ran.
alter table public.organizations
  add column if not exists trial_ends_at timestamptz;

create or replace function public.protect_org_billing_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text;
begin
  jwt_role := coalesce(current_setting('request.jwt.claim.role', true), '');

  if jwt_role = 'service_role' then
    return NEW;
  end if;

  if coalesce(current_setting('app.bypass_org_pricing_protection', true), '') = 'true' then
    return NEW;
  end if;

  if NEW.subscription_status is distinct from OLD.subscription_status then
    NEW.subscription_status := OLD.subscription_status;
  end if;

  if NEW.stripe_customer_id is distinct from OLD.stripe_customer_id then
    NEW.stripe_customer_id := OLD.stripe_customer_id;
  end if;

  if NEW.stripe_subscription_id is distinct from OLD.stripe_subscription_id then
    NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  end if;

  if NEW.trial_ends_at is distinct from OLD.trial_ends_at then
    NEW.trial_ends_at := OLD.trial_ends_at;
  end if;

  if NEW.is_founding is distinct from OLD.is_founding then
    NEW.is_founding := OLD.is_founding;
  end if;

  if NEW.locked_monthly_price_cents is distinct from OLD.locked_monthly_price_cents then
    NEW.locked_monthly_price_cents := OLD.locked_monthly_price_cents;
  end if;

  if NEW.plan is distinct from OLD.plan then
    NEW.plan := OLD.plan;
  end if;

  if NEW.founding_enrolled_at is distinct from OLD.founding_enrolled_at then
    NEW.founding_enrolled_at := OLD.founding_enrolled_at;
  end if;

  return NEW;
end;
$$;

comment on function public.protect_org_billing_fields() is
  'Reverts billing and founding/pricing column changes from authenticated clients; service_role and trusted RPCs may update.';

-- review_founding_application must set bypass before updating organizations.
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

    perform set_config('app.bypass_org_pricing_protection', 'true', true);

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

grant execute on function public.review_founding_application(uuid, boolean) to authenticated;
