import { TERMS_VERSION } from "../lib/legal";
import { requireSupabase } from "../lib/supabase";

export type ProfileTermsStatus = {
  termsAcceptedAt: string | null;
  termsVersion: string | null;
};

export async function fetchProfileTerms(userId: string): Promise<ProfileTermsStatus> {
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("terms_accepted_at, terms_version")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    termsAcceptedAt: data?.terms_accepted_at ?? null,
    termsVersion: data?.terms_version ?? null,
  };
}

export async function acceptTerms(userId: string): Promise<{ error: string | null }> {
  const acceptedAt = new Date().toISOString();
  const { error } = await requireSupabase()
    .from("profiles")
    .update({
      terms_accepted_at: acceptedAt,
      terms_version: TERMS_VERSION,
    })
    .eq("id", userId);

  return { error: error?.message ?? null };
}
