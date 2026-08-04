-- Replace weekly digest with monthly and annual visual report digests

alter table public.organizations
  add column if not exists monthly_digest_enabled boolean not null default true;

alter table public.organizations
  add column if not exists annual_digest_enabled boolean not null default true;

-- Carry forward weekly preference when present
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'weekly_digest_enabled'
  ) then
    update public.organizations
    set
      monthly_digest_enabled = weekly_digest_enabled,
      annual_digest_enabled = weekly_digest_enabled;

    alter table public.organizations drop column weekly_digest_enabled;
  end if;
end $$;

alter table public.workspace_digest_log
  add column if not exists digest_type text;

update public.workspace_digest_log
set digest_type = 'monthly'
where digest_type is null;

alter table public.workspace_digest_log
  alter column digest_type set not null;

alter table public.workspace_digest_log
  drop constraint if exists workspace_digest_log_digest_type_check;

alter table public.workspace_digest_log
  add constraint workspace_digest_log_digest_type_check
  check (digest_type in ('monthly', 'annual'));

-- digest_week → digest_period (first day of reported month or year)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workspace_digest_log'
      and column_name = 'digest_week'
  ) then
    alter table public.workspace_digest_log rename column digest_week to digest_period;
  end if;
end $$;

alter table public.workspace_digest_log
  drop constraint if exists workspace_digest_log_organization_id_digest_week_key;

alter table public.workspace_digest_log
  drop constraint if exists workspace_digest_log_organization_id_digest_type_digest_period_key;

alter table public.workspace_digest_log
  add constraint workspace_digest_log_organization_id_digest_type_digest_period_key
  unique (organization_id, digest_type, digest_period);

create index if not exists workspace_digest_log_type_period_idx
  on public.workspace_digest_log (digest_type, digest_period);
