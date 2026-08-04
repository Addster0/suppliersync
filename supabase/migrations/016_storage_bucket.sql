-- Ensure organization-files storage bucket and RLS policies exist.
-- Required after Supabase project restore (storage buckets are not always restored).
-- For manual setup, prefer STORAGE_SETUP.sql Step A first (bucket only), then Step B.

insert into storage.buckets (id, name, public)
values ('organization-files', 'organization-files', false)
on conflict (id) do nothing;

-- Recreate policies idempotently (safe to re-run)
drop policy if exists "Org members can read org files" on storage.objects;
create policy "Org members can read org files"
  on storage.objects for select
  using (
    bucket_id = 'organization-files'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Writers can upload org files" on storage.objects;
create policy "Writers can upload org files"
  on storage.objects for insert
  with check (
    bucket_id = 'organization-files'
    and public.can_write_org((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Writers can update org files" on storage.objects;
create policy "Writers can update org files"
  on storage.objects for update
  using (
    bucket_id = 'organization-files'
    and public.can_write_org((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Writers can delete org files" on storage.objects;
create policy "Writers can delete org files"
  on storage.objects for delete
  using (
    bucket_id = 'organization-files'
    and public.can_write_org((storage.foldername(name))[1]::uuid)
  );
