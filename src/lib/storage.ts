import { isSupabaseConfigValid, supabaseAnonKey, supabaseUrl } from "./supabase";

export const ORG_FILES_BUCKET = "organization-files";

/** Step A — bucket only. Run alone first; safe even if app migrations are missing. */
export const ORG_STORAGE_BUCKET_SQL =
  "insert into storage.buckets (id, name, public) values ('organization-files', 'organization-files', false) on conflict (id) do nothing;";

/** Step B — RLS policies. Requires is_org_member / can_write_org from 001_initial_schema.sql. */
export const ORG_STORAGE_POLICIES_SQL = `drop policy if exists "Org members can read org files" on storage.objects;
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
  );`;

/** Full setup (Step A + B). Prefer running Step A alone if policies might fail. */
export const ORG_STORAGE_SETUP_SQL = `-- Step A — create bucket (run this first)
${ORG_STORAGE_BUCKET_SQL}

-- Step B — access policies (run after Step A; needs 001_initial_schema.sql functions)
${ORG_STORAGE_POLICIES_SQL}`;

export function formatStorageError(message: string) {
  if (/bucket not found|nosuchbucket/i.test(message)) {
    return "File storage is not set up yet. An admin must run the storage setup SQL in the Supabase SQL Editor (see the banner at the top of the app).";
  }
  if (/object not found|resource was not found|not found/i.test(message)) {
    return "This file is no longer in storage (often after a Supabase project restore). Delete the document record and upload the file again.";
  }
  if (/row-level security|permission denied|not authorized/i.test(message)) {
    return "You don't have permission to access files in this workspace. Confirm you're signed in as an owner, admin, or member.";
  }
  return message;
}

export async function checkOrgStorageConfigured(): Promise<boolean> {
  if (!isSupabaseConfigValid || !supabaseUrl || !supabaseAnonKey) return false;

  try {
    const response = await fetch(
      `${supabaseUrl.trim()}/storage/v1/bucket/${ORG_FILES_BUCKET}`,
      {
        headers: {
          apikey: supabaseAnonKey.trim(),
          Authorization: `Bearer ${supabaseAnonKey.trim()}`,
        },
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export function getSupabaseProjectRef(): string | null {
  if (!supabaseUrl) return null;
  const match = supabaseUrl.trim().match(/https:\/\/([^.]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

export function getSupabaseSqlEditorUrl(): string {
  const ref = getSupabaseProjectRef();
  if (ref) return `https://supabase.com/dashboard/project/${ref}/sql/new`;
  return "https://supabase.com/dashboard";
}

export function getSupabaseStorageBucketsUrl(): string {
  const ref = getSupabaseProjectRef();
  if (ref) return `https://supabase.com/dashboard/project/${ref}/storage/buckets`;
  return "https://supabase.com/dashboard";
}
