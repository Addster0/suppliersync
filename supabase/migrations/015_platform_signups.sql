-- Platform signup visibility + optional founder email notification.
-- Signups are recorded when auth.users is created (not on login).

create extension if not exists pg_net with schema extensions;

create schema if not exists private;

create table if not exists private.signup_notify_settings (
  id int primary key default 1 check (id = 1),
  edge_function_url text,
  webhook_secret text,
  enabled boolean not null default false
);

revoke all on schema private from public;
revoke all on private.signup_notify_settings from public, anon, authenticated;

create or replace function private.send_signup_webhook(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  settings record;
begin
  select * into settings from private.signup_notify_settings where id = 1;
  if not found or not settings.enabled or settings.edge_function_url is null then
    return;
  end if;

  perform net.http_post(
    url := settings.edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-signup-webhook-secret', coalesce(settings.webhook_secret, '')
    ),
    body := jsonb_build_object(
      'userId', p_user_id,
      'email', p_email,
      'fullName', p_full_name,
      'createdAt', p_created_at
    )
  );
exception
  when others then
    raise warning 'Founder signup notification failed: %', sqlerrm;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  profile_full_name text := coalesce(new.raw_user_meta_data ->> 'full_name', '');
begin
  insert into public.profiles (id, email, full_name, terms_accepted_at, terms_version)
  values (
    new.id,
    new.email,
    profile_full_name,
    nullif(new.raw_user_meta_data ->> 'terms_accepted_at', '')::timestamptz,
    nullif(new.raw_user_meta_data ->> 'terms_version', '')
  );

  perform private.send_signup_webhook(
    new.id,
    new.email,
    profile_full_name,
    new.created_at
  );

  return new;
end;
$$;

create or replace function public.list_platform_signups(p_limit int default 100)
returns table (
  id uuid,
  email text,
  full_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorized.';
  end if;

  return query
  select p.id, p.email, p.full_name, p.created_at
  from public.profiles p
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

grant execute on function public.list_platform_signups(int) to authenticated;

-- One-time setup helper (run from scripts/setup-signup-notify.sh)
create or replace function public.configure_signup_notify(
  p_edge_function_url text,
  p_webhook_secret text,
  p_enabled boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorized.';
  end if;

  insert into private.signup_notify_settings (id, edge_function_url, webhook_secret, enabled)
  values (1, p_edge_function_url, p_webhook_secret, coalesce(p_enabled, true))
  on conflict (id) do update
  set
    edge_function_url = excluded.edge_function_url,
    webhook_secret = excluded.webhook_secret,
    enabled = excluded.enabled;
end;
$$;

grant execute on function public.configure_signup_notify(text, text, boolean) to authenticated;
