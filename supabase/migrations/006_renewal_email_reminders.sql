-- Email renewal reminders: org toggle + send log (dedupe by contract + window)

alter table public.organizations
  add column if not exists renewal_reminders_enabled boolean not null default true;

create table if not exists public.renewal_reminder_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  reminder_window text not null,
  sent_at timestamptz not null default now(),
  unique (contract_id, reminder_window)
);

create index if not exists renewal_reminder_log_org_idx
  on public.renewal_reminder_log (organization_id);

alter table public.renewal_reminder_log enable row level security;

drop policy if exists "Members can read renewal reminder log" on public.renewal_reminder_log;

create policy "Members can read renewal reminder log"
  on public.renewal_reminder_log for select
  using (public.is_org_member(organization_id));
