-- Auto-schedule renewal reminder + digest emails via pg_cron → pg_net → edge function.
-- Pattern matches signup/founding notify (private settings + net.http_post).
-- Edge function: send-renewal-reminders (auth via x-cron-secret; deploy with --no-verify-jwt).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;

create table if not exists private.renewal_cron_settings (
  id int primary key default 1 check (id = 1),
  edge_function_url text,
  cron_secret text,
  enabled boolean not null default false
);

revoke all on private.renewal_cron_settings from public, anon, authenticated;

create or replace function private.invoke_renewal_reminders(p_mode text)
returns bigint
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  settings record;
  request_id bigint;
begin
  if p_mode not in ('cron', 'monthly_cron', 'annual_cron') then
    raise exception 'Unsupported renewal cron mode: %', p_mode;
  end if;

  select * into settings from private.renewal_cron_settings where id = 1;
  if not found
     or not settings.enabled
     or settings.edge_function_url is null
     or coalesce(settings.cron_secret, '') = '' then
    raise warning 'Renewal cron skipped (mode=%): not configured or disabled', p_mode;
    return null;
  end if;

  request_id := net.http_post(
    url := settings.edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', settings.cron_secret
    ),
    body := jsonb_build_object('mode', p_mode)
  );

  return request_id;
exception
  when others then
    raise warning 'Renewal cron invoke failed (mode=%): %', p_mode, sqlerrm;
    return null;
end;
$$;

revoke all on function private.invoke_renewal_reminders(text) from public, anon, authenticated;

-- Platform-admin helper (optional; setup script can also write settings as postgres)
create or replace function public.configure_renewal_cron(
  p_edge_function_url text,
  p_cron_secret text,
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

  insert into private.renewal_cron_settings (id, edge_function_url, cron_secret, enabled)
  values (1, p_edge_function_url, p_cron_secret, coalesce(p_enabled, true))
  on conflict (id) do update
  set
    edge_function_url = excluded.edge_function_url,
    cron_secret = excluded.cron_secret,
    enabled = excluded.enabled;
end;
$$;

grant execute on function public.configure_renewal_cron(text, text, boolean) to authenticated;

-- Schedules run in UTC (Supabase pg_cron).
-- 14:00 UTC ≈ 7:00 AM PDT / 6:00 AM PST / 9–10 AM ET.
-- monthly_cron / annual_cron self-gate inside the edge function (1st / Jan 1).
do $$
begin
  perform cron.unschedule('send-renewal-reminders-daily');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('send-renewal-reminders-monthly-digest');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('send-renewal-reminders-annual-digest');
exception
  when others then null;
end $$;

select cron.schedule(
  'send-renewal-reminders-daily',
  '0 14 * * *',
  $$select private.invoke_renewal_reminders('cron')$$
);

select cron.schedule(
  'send-renewal-reminders-monthly-digest',
  '5 14 * * *',
  $$select private.invoke_renewal_reminders('monthly_cron')$$
);

select cron.schedule(
  'send-renewal-reminders-annual-digest',
  '10 14 * * *',
  $$select private.invoke_renewal_reminders('annual_cron')$$
);

comment on table private.renewal_cron_settings is
  'Settings for pg_cron → pg_net calls to send-renewal-reminders. Enable via configure_renewal_cron or setup-renewal-email.sh.';
