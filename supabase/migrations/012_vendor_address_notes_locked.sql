-- Vendor street address + lock finalized notes.

alter table public.vendors
  add column if not exists address text not null default '',
  add column if not exists notes_locked boolean not null default false;
