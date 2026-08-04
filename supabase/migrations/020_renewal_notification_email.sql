-- Optional override for renewal reminder delivery (e.g. Gmail when signup ISP blocks mail).
alter table public.profiles
  add column if not exists renewal_notification_email text;

comment on column public.profiles.renewal_notification_email is
  'When set, renewal and digest emails go here instead of auth.users.email.';
