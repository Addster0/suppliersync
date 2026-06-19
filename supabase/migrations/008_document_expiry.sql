-- Optional expiry for compliance documents (COI, license, etc.)

alter table public.documents
  add column if not exists expires_at date;

comment on column public.documents.expires_at is 'When this compliance document expires (COI, license, etc.).';
