-- =============================================================================
-- SupplierSync — storage setup (run after Supabase project restore)
-- =============================================================================
-- Storage buckets are NOT restored with database backups. Run Step A first.
-- Safe to re-run (uses on conflict / drop policy if exists).
-- Do NOT paste shell scripts or app code here — SQL only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP A — Create bucket only (run this first; almost always succeeds)
-- -----------------------------------------------------------------------------
-- Paste ONLY the line below into SQL Editor → Run. Then check Storage → Buckets.

insert into storage.buckets (id, name, public) values ('organization-files', 'organization-files', false) on conflict (id) do nothing;

-- Verify (optional): should return one row
-- select id, name, public from storage.buckets where id = 'organization-files';


-- -----------------------------------------------------------------------------
-- STEP B — Access policies (run AFTER Step A succeeds)
-- -----------------------------------------------------------------------------
-- Requires public.is_org_member and public.can_write_org from 001_initial_schema.sql.
-- If this fails, the bucket from Step A still exists — fix migrations, then re-run Step B.

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
