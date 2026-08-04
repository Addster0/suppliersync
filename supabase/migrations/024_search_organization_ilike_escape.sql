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
