-- Prevent org owners/admins from self-upgrading subscription via RLS update policy.
-- Billing fields may only be changed by service_role (Stripe webhook edge function).

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

  return NEW;
end;
$$;

drop trigger if exists protect_org_billing_fields on public.organizations;

create trigger protect_org_billing_fields
  before update on public.organizations
  for each row
  execute function public.protect_org_billing_fields();

comment on function public.protect_org_billing_fields() is
  'Reverts billing column changes from authenticated clients; service_role (webhooks) may update.';
