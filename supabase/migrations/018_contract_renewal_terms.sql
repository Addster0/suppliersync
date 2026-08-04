-- Support auto-renew, month-to-month, and evergreen contracts without fake end dates.

create type public.contract_renewal_type as enum (
  'fixed_term',
  'auto_renew',
  'month_to_month',
  'evergreen'
);

alter table public.contracts
  alter column end_date drop not null;

alter table public.contracts
  add column renewal_type public.contract_renewal_type not null default 'fixed_term',
  add column notice_period_days integer check (notice_period_days is null or notice_period_days >= 0),
  add column term_months integer check (term_months is null or term_months > 0);

-- renewal_date (existing column) stores review / notice-deadline dates for non-fixed-term contracts.

create index contracts_renewal_date_idx on public.contracts (renewal_date)
  where renewal_date is not null;
