-- Ensure contracts cannot be saved against a vendor from another workspace.
-- Prevents silent "saved but missing after refresh" when org/vendor IDs mismatch.

create or replace function public.enforce_contract_vendor_org_match()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.vendors v
    where v.id = new.vendor_id
      and v.organization_id = new.organization_id
  ) then
    raise exception 'Contract vendor must belong to the same workspace as the contract.';
  end if;

  return new;
end;
$$;

drop trigger if exists contracts_vendor_org_match on public.contracts;

create trigger contracts_vendor_org_match
  before insert or update on public.contracts
  for each row
  execute function public.enforce_contract_vendor_org_match();
