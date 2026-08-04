-- Server-side subscription enforcement for tenant data writes.
-- Mirrors isSubscriptionActive() in src/lib/stripe.ts.
-- Reads remain allowed (billing page, inactive workspace viewing).
-- service_role bypasses RLS (Stripe webhook, cron).

-- Ensure trial column exists (013 may not have been applied in production).
alter table public.organizations
  add column if not exists trial_ends_at timestamptz;

update public.organizations
set trial_ends_at = case
  when created_at + interval '14 days' > now() then created_at + interval '14 days'
  else now() + interval '14 days'
end
where trial_ends_at is null;

create or replace function public.org_has_active_subscription(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when o.subscription_status = 'active' then true
        when o.subscription_status = 'trialing' then
          case
            when o.trial_ends_at is null then true
            else o.trial_ends_at > now()
          end
        else false
      end
      from public.organizations o
      where o.id = org_id
    ),
    false
  );
$$;

grant execute on function public.org_has_active_subscription(uuid) to authenticated;

comment on function public.org_has_active_subscription(uuid) is
  'True when org subscription is active or trialing with trial_ends_at in the future (matches client isSubscriptionActive).';

-- Tenant tables: require active subscription for writes (non-service_role via RLS).
drop policy if exists "Writers can manage vendors" on public.vendors;
create policy "Writers can manage vendors"
  on public.vendors for all
  using (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  )
  with check (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  );

drop policy if exists "Writers can manage contacts" on public.contacts;
create policy "Writers can manage contacts"
  on public.contacts for all
  using (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  )
  with check (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  );

drop policy if exists "Writers can manage contracts" on public.contracts;
create policy "Writers can manage contracts"
  on public.contracts for all
  using (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  )
  with check (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  );

drop policy if exists "Writers can manage documents" on public.documents;
create policy "Writers can manage documents"
  on public.documents for all
  using (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  )
  with check (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  );

drop policy if exists "Writers can manage spend" on public.vendor_spend_snapshots;
create policy "Writers can manage spend"
  on public.vendor_spend_snapshots for all
  using (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  )
  with check (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  );

drop policy if exists "Writers can manage evaluations" on public.vendor_evaluations;
create policy "Writers can manage evaluations"
  on public.vendor_evaluations for all
  using (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  )
  with check (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  );

drop policy if exists "Writers can manage experiments" on public.vendor_experiments;
create policy "Writers can manage experiments"
  on public.vendor_experiments for all
  using (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  )
  with check (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  );

-- Storage writes in organization-files bucket.
drop policy if exists "Writers can upload org files" on storage.objects;
create policy "Writers can upload org files"
  on storage.objects for insert
  with check (
    bucket_id = 'organization-files'
    and public.can_write_org((storage.foldername(name))[1]::uuid)
    and public.org_has_active_subscription((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Writers can update org files" on storage.objects;
create policy "Writers can update org files"
  on storage.objects for update
  using (
    bucket_id = 'organization-files'
    and public.can_write_org((storage.foldername(name))[1]::uuid)
    and public.org_has_active_subscription((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Writers can delete org files" on storage.objects;
create policy "Writers can delete org files"
  on storage.objects for delete
  using (
    bucket_id = 'organization-files'
    and public.can_write_org((storage.foldername(name))[1]::uuid)
    and public.org_has_active_subscription((storage.foldername(name))[1]::uuid)
  );
