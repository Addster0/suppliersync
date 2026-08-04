-- Track when a clinic has handled a renewal so it drops off urgent lists.

alter table public.contracts
  add column renewal_handled_at timestamptz,
  add column renewal_handled_note text;

create index contracts_renewal_handled_at_idx on public.contracts (renewal_handled_at)
  where renewal_handled_at is not null;
