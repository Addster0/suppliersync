-- Insurance payer CRM (participation agreements / credentialing).

create table if not exists public.insurance_payers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  payer_type text not null default 'commercial',
  primary_contact_name text not null default '',
  primary_contact_email text not null default '',
  primary_contact_phone text not null default '',
  notes text not null default '',
  status public.vendor_status not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists insurance_payers_org_id_idx on public.insurance_payers (organization_id);

create table if not exists public.insurance_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payer_id uuid not null references public.insurance_payers (id) on delete cascade,
  title text not null,
  policy_number text not null default '',
  start_date date not null,
  end_date date not null,
  credentialing_status text not null default 'active',
  file_url text,
  file_name text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint insurance_contracts_file_url_sb_scheme
    check (file_url is null or file_url like 'sb://%')
);

create index if not exists insurance_contracts_org_id_idx on public.insurance_contracts (organization_id);
create index if not exists insurance_contracts_payer_id_idx on public.insurance_contracts (payer_id);

alter table public.insurance_payers enable row level security;
alter table public.insurance_contracts enable row level security;

create policy "Org members can read insurance_payers"
  on public.insurance_payers for select
  using (public.is_org_member(organization_id));

create policy "Writers can manage insurance_payers"
  on public.insurance_payers for all
  using (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  )
  with check (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  );

create policy "Org members can read insurance_contracts"
  on public.insurance_contracts for select
  using (public.is_org_member(organization_id));

create policy "Writers can manage insurance_contracts"
  on public.insurance_contracts for all
  using (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  )
  with check (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  );
