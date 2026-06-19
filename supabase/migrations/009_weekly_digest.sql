-- Weekly workspace digest (Needs attention summary email)

alter table public.organizations
  add column if not exists weekly_digest_enabled boolean not null default true;

create table if not exists public.workspace_digest_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  digest_week date not null,
  sent_at timestamptz not null default now(),
  unique (organization_id, digest_week)
);

create index if not exists workspace_digest_log_org_idx
  on public.workspace_digest_log (organization_id);

alter table public.workspace_digest_log enable row level security;

drop policy if exists "Members can read workspace digest log" on public.workspace_digest_log;

create policy "Members can read workspace digest log"
  on public.workspace_digest_log for select
  using (public.is_org_member(organization_id));
