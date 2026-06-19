import { requireSupabase } from "../lib/supabase";

export type FoundingApplication = {
  id: string;
  organizationId: string;
  clinicName: string;
  website: string | null;
  applicantRole: string;
  note: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
};

export type PendingFoundingApplication = {
  id: string;
  organizationId: string;
  organizationName: string;
  clinicName: string;
  website: string | null;
  applicantRole: string;
  note: string;
  submitterEmail: string;
  createdAt: string;
};

export async function fetchMyFoundingApplication(
  organizationId: string
): Promise<FoundingApplication | null> {
  const { data, error } = await requireSupabase()
    .from("founding_applications")
    .select(
      "id, organization_id, clinic_name, website, applicant_role, note, status, created_at, reviewed_at"
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id,
    organizationId: data.organization_id,
    clinicName: data.clinic_name,
    website: data.website,
    applicantRole: data.applicant_role,
    note: data.note,
    status: data.status as FoundingApplication["status"],
    createdAt: data.created_at,
    reviewedAt: data.reviewed_at,
  };
}

export async function submitFoundingApplication(input: {
  organizationId: string;
  clinicName: string;
  website?: string;
  applicantRole: string;
  note: string;
}) {
  const { data, error } = await requireSupabase().rpc("submit_founding_application", {
    p_organization_id: input.organizationId,
    p_clinic_name: input.clinicName,
    p_website: input.website ?? "",
    p_applicant_role: input.applicantRole,
    p_note: input.note,
  });

  if (error) throw new Error(error.message);
  return data as string;
}

export async function fetchIsPlatformAdmin() {
  const { data, error } = await requireSupabase().rpc("is_platform_admin_for_client");
  if (error) return false;
  return Boolean(data);
}

export async function fetchPendingFoundingApplications(): Promise<PendingFoundingApplication[]> {
  const { data, error } = await requireSupabase().rpc("list_pending_founding_applications");
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, string | null>) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    organizationName: row.organization_name as string,
    clinicName: row.clinic_name as string,
    website: row.website,
    applicantRole: row.applicant_role as string,
    note: row.note as string,
    submitterEmail: row.submitter_email as string,
    createdAt: row.created_at as string,
  }));
}

export async function reviewFoundingApplication(applicationId: string, approve: boolean) {
  const { error } = await requireSupabase().rpc("review_founding_application", {
    p_application_id: applicationId,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
}
