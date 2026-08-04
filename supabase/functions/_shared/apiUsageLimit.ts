import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Default hourly cap per workspace for AI extract endpoints. */
export const EXTRACT_MAX_PER_ORG_PER_HOUR = 30;

export async function checkAndLogExtractUsage(
  userClient: SupabaseClient,
  organizationId: string,
  endpoint: "extract-contract" | "extract-document",
  maxPerHour = EXTRACT_MAX_PER_ORG_PER_HOUR,
): Promise<{ allowed: true } | { allowed: false; message: string; status: number }> {
  const { error } = await userClient.rpc("check_and_log_api_usage", {
    p_org_id: organizationId,
    p_endpoint: endpoint,
    p_max_per_hour: maxPerHour,
  });

  if (error) {
    const message = error.message ?? "Rate limit check failed.";
    const isRateLimit = message.includes("Rate limit exceeded");
    return {
      allowed: false,
      message,
      status: isRateLimit ? 429 : 500,
    };
  }

  return { allowed: true };
}
