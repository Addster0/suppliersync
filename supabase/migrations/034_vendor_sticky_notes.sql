-- Per-vendor sticky notes (multiple note cards per vendor).

create table if not exists public.vendor_sticky_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_sticky_notes_org_id_idx on public.vendor_sticky_notes (organization_id);
create index if not exists vendor_sticky_notes_vendor_id_idx on public.vendor_sticky_notes (vendor_id);

alter table public.vendor_sticky_notes enable row level security;

drop policy if exists "Org members can read vendor_sticky_notes" on public.vendor_sticky_notes;
create policy "Org members can read vendor_sticky_notes"
  on public.vendor_sticky_notes for select
  using (public.is_org_member(organization_id));

drop policy if exists "Writers can manage vendor_sticky_notes" on public.vendor_sticky_notes;
create policy "Writers can manage vendor_sticky_notes"
  on public.vendor_sticky_notes for all
  using (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  )
  with check (
    public.can_write_org(organization_id)
    and public.org_has_active_subscription(organization_id)
  );

grant select, insert, update, delete on public.vendor_sticky_notes to authenticated;

-- Move legacy single notes field into first sticky note card.
insert into public.vendor_sticky_notes (organization_id, vendor_id, body)
select organization_id, id, trim(notes)
from public.vendors
where trim(notes) <> ''
  and not exists (
    select 1 from public.vendor_sticky_notes n where n.vendor_id = vendors.id
  );

update public.vendors
set notes = '', notes_locked = false
where trim(notes) <> '';

-- Include sticky notes in workspace search.
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

    select 'note'::text, n.id, n.vendor_id, v.name, left(n.body, 80), to_char(n.created_at, 'YYYY-MM-DD')
    from public.vendor_sticky_notes n
    join public.vendors v on v.id = n.vendor_id
    where n.organization_id = p_org_id
      and n.body ilike pattern escape '\'

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
