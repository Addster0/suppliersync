-- CRM relationship email: outbound messages to vendor contacts (Resend via edge function).

create table if not exists public.vendor_email_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  to_email text not null,
  to_name text not null default '',
  subject text not null,
  body_text text not null,
  status text not null default 'sent'
    check (status in ('sent', 'failed')),
  error_message text,
  resend_email_id text,
  sent_by uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint vendor_email_messages_to_email_len check (char_length(to_email) <= 320),
  constraint vendor_email_messages_subject_len check (char_length(subject) <= 500),
  constraint vendor_email_messages_body_len check (char_length(body_text) <= 20000)
);

create index if not exists vendor_email_messages_org_vendor_sent_idx
  on public.vendor_email_messages (organization_id, vendor_id, sent_at desc);

create index if not exists vendor_email_messages_contact_idx
  on public.vendor_email_messages (contact_id)
  where contact_id is not null;

alter table public.vendor_email_messages enable row level security;

drop policy if exists "Org members can read vendor_email_messages" on public.vendor_email_messages;
create policy "Org members can read vendor_email_messages"
  on public.vendor_email_messages for select
  using (public.is_org_member(organization_id));

-- Inserts/updates go through the send-vendor-email edge function (service role).
-- No client write policies — relationship history is append-only from the server.

grant select on public.vendor_email_messages to authenticated;

comment on table public.vendor_email_messages is
  'Outbound CRM emails to vendor contacts. Written by send-vendor-email edge function; org members can read.';
