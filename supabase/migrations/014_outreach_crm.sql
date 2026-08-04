-- Founder outreach CRM — personal lead pipeline (user-scoped, not org-scoped)

create type public.outreach_stage as enum (
  'research',
  'contacted',
  'replied',
  'trial',
  'founding',
  'converted',
  'not_interested',
  'nurture'
);

create type public.outreach_fit as enum ('high', 'medium', 'low');

create type public.outreach_source as enum (
  'npi',
  'google',
  'referral',
  'linkedin',
  'conference',
  'other'
);

create type public.outreach_activity_type as enum (
  'email',
  'linkedin',
  'call',
  'meeting',
  'note'
);

create table public.outreach_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  clinic_name text not null,
  contact_name text not null default '',
  role text not null default '',
  email text not null default '',
  phone text not null default '',
  linkedin_url text not null default '',
  city text not null default '',
  specialty text not null default '',
  source public.outreach_source not null default 'other',
  fit public.outreach_fit not null default 'medium',
  tags text[] not null default '{}',
  stage public.outreach_stage not null default 'research',
  notes text not null default '',
  next_action_date date,
  next_action_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outreach_leads_user_id_idx on public.outreach_leads (user_id);
create index outreach_leads_stage_idx on public.outreach_leads (user_id, stage);
create index outreach_leads_next_action_idx on public.outreach_leads (user_id, next_action_date);

create table public.outreach_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  lead_id uuid not null references public.outreach_leads (id) on delete cascade,
  activity_type public.outreach_activity_type not null,
  summary text not null default '',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index outreach_activities_user_id_idx on public.outreach_activities (user_id);
create index outreach_activities_lead_id_idx on public.outreach_activities (lead_id);
create index outreach_activities_occurred_idx on public.outreach_activities (user_id, occurred_at);

create or replace function public.touch_outreach_lead_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.outreach_leads
  set updated_at = now()
  where id = new.lead_id;
  return new;
end;
$$;

create trigger outreach_activity_updates_lead
  after insert on public.outreach_activities
  for each row execute function public.touch_outreach_lead_updated_at();

-- Row Level Security — each user sees only their own outreach data

alter table public.outreach_leads enable row level security;
alter table public.outreach_activities enable row level security;

create policy "Users manage own outreach leads"
  on public.outreach_leads for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own outreach activities"
  on public.outreach_activities for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
