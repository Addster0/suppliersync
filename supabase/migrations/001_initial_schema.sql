-- Vendor Manager SaaS — Phase 1 foundation
-- Run in Supabase SQL Editor or via `supabase db push`

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Profiles (extends auth.users)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Organizations & membership
-- ---------------------------------------------------------------------------

create type public.org_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.vendor_status as enum ('active', 'inactive', 'pending', 'expired');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'trial',
  subscription_status text not null default 'trialing',
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_user_id_idx on public.organization_members (user_id);
create index organization_members_org_id_idx on public.organization_members (organization_id);

-- ---------------------------------------------------------------------------
-- Vendor domain tables
-- ---------------------------------------------------------------------------

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  category text not null,
  status public.vendor_status not null default 'pending',
  notes text not null default '',
  directory_id text,
  created_at timestamptz not null default now()
);

create index vendors_org_id_idx on public.vendors (organization_id);
create index vendors_name_trgm_idx on public.vendors using gin (name gin_trgm_ops);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  name text not null,
  email text not null default '',
  phone text not null default '',
  role text not null default ''
);

create index contacts_org_id_idx on public.contacts (organization_id);
create index contacts_vendor_id_idx on public.contacts (vendor_id);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,
  renewal_date date,
  value numeric(12, 2) not null default 0,
  status public.vendor_status not null default 'pending',
  file_url text,
  file_name text,
  file_size bigint,
  mime_type text,
  created_at timestamptz not null default now()
);

create index contracts_org_id_idx on public.contracts (organization_id);
create index contracts_vendor_id_idx on public.contracts (vendor_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  title text not null,
  file_url text not null,
  file_size bigint not null default 0,
  doc_type text not null default 'general',
  created_at timestamptz not null default now()
);

create index documents_org_id_idx on public.documents (organization_id);
create index documents_vendor_id_idx on public.documents (vendor_id);

create table public.vendor_spend_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  entry_date date not null,
  description text not null,
  amount numeric(12, 2) not null,
  entry_type text not null check (entry_type in ('payment', 'credit', 'adjustment')),
  source text not null default 'manual' check (source in ('manual', 'imported', 'estimated')),
  period_start date,
  period_end date,
  notes text,
  created_at timestamptz not null default now()
);

create index spend_org_id_idx on public.vendor_spend_snapshots (organization_id);
create index spend_vendor_id_idx on public.vendor_spend_snapshots (vendor_id);

create table public.vendor_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  eval_date date not null,
  score smallint not null check (score between 1 and 10),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table public.vendor_experiments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'idea' check (status in ('idea', 'testing', 'keeper')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = org_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(org_id uuid, allowed_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = org_id
      and user_id = auth.uid()
      and role = any (allowed_roles)
  );
$$;

create or replace function public.can_write_org(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_org_role(org_id, array['owner', 'admin', 'member']::public.org_role[]);
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.vendors enable row level security;
alter table public.contacts enable row level security;
alter table public.contracts enable row level security;
alter table public.documents enable row level security;
alter table public.vendor_spend_snapshots enable row level security;
alter table public.vendor_evaluations enable row level security;
alter table public.vendor_experiments enable row level security;

-- Profiles
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Organizations
create policy "Members can read their organizations"
  on public.organizations for select
  using (public.is_org_member(id));

create policy "Authenticated users can create organizations"
  on public.organizations for insert
  with check (auth.uid() is not null);

create policy "Owners and admins can update organizations"
  on public.organizations for update
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

-- Organization members
create policy "Members can read org membership"
  on public.organization_members for select
  using (public.is_org_member(organization_id));

create policy "Owners and admins can manage membership"
  on public.organization_members for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "Users can insert themselves as owner on new org"
  on public.organization_members for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and not exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_members.organization_id
    )
  );

-- Generic read/write policies for tenant tables
create policy "Org members can read vendors"
  on public.vendors for select using (public.is_org_member(organization_id));

create policy "Writers can manage vendors"
  on public.vendors for all
  using (public.can_write_org(organization_id))
  with check (public.can_write_org(organization_id));

create policy "Org members can read contacts"
  on public.contacts for select using (public.is_org_member(organization_id));

create policy "Writers can manage contacts"
  on public.contacts for all
  using (public.can_write_org(organization_id))
  with check (public.can_write_org(organization_id));

create policy "Org members can read contracts"
  on public.contracts for select using (public.is_org_member(organization_id));

create policy "Writers can manage contracts"
  on public.contracts for all
  using (public.can_write_org(organization_id))
  with check (public.can_write_org(organization_id));

create policy "Org members can read documents"
  on public.documents for select using (public.is_org_member(organization_id));

create policy "Writers can manage documents"
  on public.documents for all
  using (public.can_write_org(organization_id))
  with check (public.can_write_org(organization_id));

create policy "Org members can read spend"
  on public.vendor_spend_snapshots for select using (public.is_org_member(organization_id));

create policy "Writers can manage spend"
  on public.vendor_spend_snapshots for all
  using (public.can_write_org(organization_id))
  with check (public.can_write_org(organization_id));

create policy "Org members can read evaluations"
  on public.vendor_evaluations for select using (public.is_org_member(organization_id));

create policy "Writers can manage evaluations"
  on public.vendor_evaluations for all
  using (public.can_write_org(organization_id))
  with check (public.can_write_org(organization_id));

create policy "Org members can read experiments"
  on public.vendor_experiments for select using (public.is_org_member(organization_id));

create policy "Writers can manage experiments"
  on public.vendor_experiments for all
  using (public.can_write_org(organization_id))
  with check (public.can_write_org(organization_id));

-- ---------------------------------------------------------------------------
-- Cross-table search
-- ---------------------------------------------------------------------------

create or replace function public.search_organization(p_org_id uuid, p_query text)
returns table (
  entity_type text,
  entity_id uuid,
  vendor_id uuid,
  vendor_name text,
  title text,
  subtitle text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  q text := trim(p_query);
  pattern text;
begin
  if length(q) < 2 then
    return;
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'Not authorized';
  end if;

  pattern := '%' || q || '%';

  return query
  select *
  from (
    select 'vendor'::text, v.id, v.id, v.name, v.category, coalesce(v.notes, '')
    from public.vendors v
    where v.organization_id = p_org_id
      and (v.name ilike pattern or v.category ilike pattern or v.notes ilike pattern)

    union all

    select 'contact'::text, c.id, c.vendor_id, v.name, c.name, coalesce(c.email, '') || ' · ' || coalesce(c.role, '')
    from public.contacts c
    join public.vendors v on v.id = c.vendor_id
    where c.organization_id = p_org_id
      and (
        c.name ilike pattern
        or c.email ilike pattern
        or c.phone ilike pattern
        or c.role ilike pattern
      )

    union all

    select 'contract'::text, c.id, c.vendor_id, v.name, c.title,
      to_char(c.start_date, 'YYYY-MM-DD') || ' – ' || to_char(c.end_date, 'YYYY-MM-DD')
    from public.contracts c
    join public.vendors v on v.id = c.vendor_id
    where c.organization_id = p_org_id
      and c.title ilike pattern

    union all

    select 'document'::text, d.id, d.vendor_id, v.name, d.title, d.doc_type
    from public.documents d
    join public.vendors v on v.id = d.vendor_id
    where d.organization_id = p_org_id
      and d.title ilike pattern

    union all

    select 'spend'::text, s.id, s.vendor_id, v.name, s.description,
      to_char(s.entry_date, 'YYYY-MM-DD') || ' · ' || s.entry_type
    from public.vendor_spend_snapshots s
    join public.vendors v on v.id = s.vendor_id
    where s.organization_id = p_org_id
      and (s.description ilike pattern or coalesce(s.notes, '') ilike pattern)

    union all

    select 'evaluation'::text, e.id, e.vendor_id, v.name,
      e.score::text || '/10', coalesce(e.notes, '')
    from public.vendor_evaluations e
    join public.vendors v on v.id = e.vendor_id
    where e.organization_id = p_org_id
      and coalesce(e.notes, '') ilike pattern
  ) combined
  order by combined.vendor_name, combined.title
  limit 50;
end;
$$;

grant execute on function public.search_organization(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for org files
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('organization-files', 'organization-files', false)
on conflict (id) do nothing;

create policy "Org members can read org files"
  on storage.objects for select
  using (
    bucket_id = 'organization-files'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy "Writers can upload org files"
  on storage.objects for insert
  with check (
    bucket_id = 'organization-files'
    and public.can_write_org((storage.foldername(name))[1]::uuid)
  );

create policy "Writers can update org files"
  on storage.objects for update
  using (
    bucket_id = 'organization-files'
    and public.can_write_org((storage.foldername(name))[1]::uuid)
  );

create policy "Writers can delete org files"
  on storage.objects for delete
  using (
    bucket_id = 'organization-files'
    and public.can_write_org((storage.foldername(name))[1]::uuid)
  );
