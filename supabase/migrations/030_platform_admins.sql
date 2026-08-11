-- Platform admins: replace hardcoded email in is_platform_admin().
-- After deploy: add admins with
--   insert into public.platform_admins (user_id) select id from auth.users where email = 'you@example.com';

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- No direct client access; checked only via security definer function.
drop policy if exists "No direct platform_admins access" on public.platform_admins;
create policy "No direct platform_admins access"
  on public.platform_admins for all
  using (false)
  with check (false);

-- Migrate anyone who was platform admin via legacy email check.
insert into public.platform_admins (user_id)
select p.id
from public.profiles p
where lower(p.email) in ('addstero28@gmail.com')
on conflict (user_id) do nothing;

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$$;

grant execute on function public.is_platform_admin() to authenticated;
