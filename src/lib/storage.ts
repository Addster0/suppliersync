import { isSupabaseConfigValid, requireSupabase, supabaseUrl } from "./supabase";

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

export type OrgStorageStatus = "ok" | "missing_bucket" | "policy_error" | "not_signed_in" | "unknown";

export function formatStorageError(message: string) {
  if (/bucket not found|nosuchbucket/i.test(message)) {
    return "File storage is not set up yet. Create the organization-files bucket in Supabase (Account → System status shows setup steps).";
  }
  if (/object not found|resource was not found|not found/i.test(message)) {
    return "This file is no longer in storage (often after a Supabase project restore). Delete the document record and upload the file again.";
  }
  if (/row-level security|permission denied|not authorized/i.test(message)) {
    return "You don't have permission to access files in this workspace. Confirm you're signed in as an owner, admin, or member. If you are, run the storage policies SQL (Step B) in Supabase.";
  }
  if (/invalid jwt/i.test(message)) {
    return "Sign-in session expired or invalid. Sign out, sign back in, and try again.";
  }
  return message;
}

function isStoragePolicyError(message: string) {
  return /row-level security|permission denied|not authorized|new row violates/i.test(message);
}

function isMissingBucketError(message: string) {
  return /not found|nosuchbucket/i.test(message);
}

/**
 * Probe storage using list() + a tiny upload on storage.objects — not getBucket(),
 * which requires SELECT on storage.buckets (clinic users never have that on private buckets).
 * List alone only proves read access; uploads need INSERT policies (Step B).
 */
export async function probeOrgStorage(organizationId?: string): Promise<{
  status: OrgStorageStatus;
  detail: string;
}> {
  if (!isSupabaseConfigValid) {
    return { status: "unknown", detail: "Supabase is not configured in this build." };
  }

  try {
    const client = requireSupabase();
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) {
      return { status: "not_signed_in", detail: "Sign in to verify document storage." };
    }

    const prefix = organizationId?.trim() || "";
    const { error: listError } = await client.storage.from(ORG_FILES_BUCKET).list(prefix, { limit: 1 });

    if (listError) {
      if (isMissingBucketError(listError.message)) {
        return {
          status: "missing_bucket",
          detail:
            "The organization-files bucket is missing. Run Step A in the Supabase SQL Editor or create the bucket under Storage → Buckets.",
        };
      }

      if (isStoragePolicyError(listError.message)) {
        return {
          status: "policy_error",
          detail:
            "The bucket exists but storage read policies are missing or incorrect. Run Step B (policies SQL) in the Supabase SQL Editor.",
        };
      }

      return { status: "unknown", detail: listError.message };
    }

    if (prefix) {
      const probePath = `${prefix}/.storage-probe-${Date.now()}.txt`;
      const probeBody = new Blob(["probe"], { type: "text/plain" });
      const { error: uploadError } = await client.storage.from(ORG_FILES_BUCKET).upload(probePath, probeBody, {
        upsert: true,
        contentType: "text/plain",
      });

      if (uploadError) {
        if (isStoragePolicyError(uploadError.message)) {
          return {
            status: "policy_error",
            detail:
              "The bucket exists and files can be listed, but uploads are blocked — usually missing INSERT policies from Step B. Run the storage policies SQL in the Supabase SQL Editor.",
          };
        }

        if (isMissingBucketError(uploadError.message)) {
          return {
            status: "missing_bucket",
            detail:
              "The organization-files bucket is missing. Run Step A in the Supabase SQL Editor or create the bucket under Storage → Buckets.",
          };
        }

        return { status: "unknown", detail: formatStorageError(uploadError.message) };
      }

      await client.storage.from(ORG_FILES_BUCKET).remove([probePath]);
    }

    return {
      status: "ok",
      detail: prefix
        ? "Document storage is configured — uploads and viewing should work."
        : "The organization-files bucket is reachable. Open a workspace to verify upload permissions.",
    };
  } catch {
    return { status: "unknown", detail: "Could not verify document storage." };
  }
}

/** Requires a signed-in session — private buckets are not visible to the anon key. */
export async function checkOrgStorageConfigured(organizationId?: string): Promise<boolean> {
  const { status } = await probeOrgStorage(organizationId);
  return status === "ok";
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

export function getSupabaseEdgeSecretsUrl(): string {
  const ref = getSupabaseProjectRef();
  if (ref) return `https://supabase.com/dashboard/project/${ref}/functions/secrets`;
  return "https://supabase.com/dashboard";
}
