-- Abuse prevention: org creation cap, AI extract rate limits, search query length.

-- ---------------------------------------------------------------------------
-- api_usage_log — tracks expensive edge-function calls per org (used by extract-*)
-- ---------------------------------------------------------------------------

create table if not exists public.api_usage_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  endpoint text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists api_usage_log_org_endpoint_created_idx
  on public.api_usage_log (organization_id, endpoint, created_at desc);

alter table public.api_usage_log enable row level security;
-- No policies: authenticated users access only via security-definer RPC below.

comment on table public.api_usage_log is
  'Per-org API usage for rate limiting expensive operations (AI extract). Rows older than 7 days can be purged by cron.';

-- ---------------------------------------------------------------------------
-- check_and_log_api_usage — called by extract edge functions (user JWT)
-- ---------------------------------------------------------------------------

create or replace function public.check_and_log_api_usage(
  p_org_id uuid,
  p_endpoint text,
  p_max_per_hour int default 30
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  recent_count int;
  v_endpoint text := trim(p_endpoint);
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'Not authorized';
  end if;

  if v_endpoint is null or length(v_endpoint) = 0 then
    raise exception 'endpoint is required';
  end if;

  select count(*)::int into recent_count
  from public.api_usage_log
  where organization_id = p_org_id
    and api_usage_log.endpoint = v_endpoint
    and created_at > now() - interval '1 hour';

  if recent_count >= p_max_per_hour then
    raise exception 'Rate limit exceeded: % AI extractions per hour for this workspace. Try again later.', p_max_per_hour;
  end if;

  insert into public.api_usage_log (organization_id, endpoint, user_id)
  values (p_org_id, v_endpoint, uid);
end;
$$;

grant execute on function public.check_and_log_api_usage(uuid, text, int) to authenticated;

comment on function public.check_and_log_api_usage(uuid, text, int) is
  'Enforces per-org hourly cap on expensive API calls. Inserts a log row when allowed.';

-- ---------------------------------------------------------------------------
-- create_organization — cap workspaces per user (default 5)
-- ---------------------------------------------------------------------------

create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  uid uuid := auth.uid();
  org_count int;
  max_orgs constant int := 5;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(p_name)) = 0 then
    raise exception 'Organization name is required';
  end if;

  select count(*)::int into org_count
  from public.organization_members
  where user_id = uid;

  if org_count >= max_orgs then
    raise exception 'You can create at most % workspaces per account.', max_orgs;
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

-- ---------------------------------------------------------------------------
-- search_organization — max query length (100 chars)
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
  max_query_len constant int := 100;
begin
  if length(q) < 2 then
    return;
  end if;

  if length(q) > max_query_len then
    raise exception 'Search query is too long (max % characters).', max_query_len;
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'Not authorized';
  end if;

  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select *
  from (
    select 'vendor'::text, v.id, v.id, v.name, v.category, coalesce(v.notes, '')
    from public.vendors v
    where v.organization_id = p_org_id
      and (v.name ilike pattern escape '\' or v.category ilike pattern escape '\' or v.notes ilike pattern escape '\')

    union all

    select 'contact'::text, c.id, c.vendor_id, v.name, c.name, coalesce(c.email, '') || ' · ' || coalesce(c.role, '')
    from public.contacts c
    join public.vendors v on v.id = c.vendor_id
    where c.organization_id = p_org_id
      and (
        c.name ilike pattern escape '\'
        or c.email ilike pattern escape '\'
        or c.phone ilike pattern escape '\'
        or c.role ilike pattern escape '\'
      )

    union all

    select 'contract'::text, c.id, c.vendor_id, v.name, c.title,
      to_char(c.start_date, 'YYYY-MM-DD') || ' – ' || to_char(c.end_date, 'YYYY-MM-DD')
    from public.contracts c
    join public.vendors v on v.id = c.vendor_id
    where c.organization_id = p_org_id
      and c.title ilike pattern escape '\'

    union all

    select 'document'::text, d.id, d.vendor_id, v.name, d.title, d.doc_type
    from public.documents d
    join public.vendors v on v.id = d.vendor_id
    where d.organization_id = p_org_id
      and d.title ilike pattern escape '\'

    union all

    select 'spend'::text, s.id, s.vendor_id, v.name, s.description,
      to_char(s.entry_date, 'YYYY-MM-DD') || ' · ' || s.entry_type
    from public.vendor_spend_snapshots s
    join public.vendors v on v.id = s.vendor_id
    where s.organization_id = p_org_id
      and (s.description ilike pattern escape '\' or coalesce(s.notes, '') ilike pattern escape '\')

    union all

    select 'evaluation'::text, e.id, e.vendor_id, v.name,
      e.score::text || '/10', coalesce(e.notes, '')
    from public.vendor_evaluations e
    join public.vendors v on v.id = e.vendor_id
    where e.organization_id = p_org_id
      and coalesce(e.notes, '') ilike pattern escape '\'
  ) combined
  order by combined.vendor_name, combined.title
  limit 50;
end;
$$;

grant execute on function public.search_organization(uuid, text) to authenticated;
