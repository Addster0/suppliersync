import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Default hourly cap per workspace for AI extract endpoints. */
export const EXTRACT_MAX_PER_ORG_PER_HOUR = 30;

function getAdminClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

function isRateLimitSchemaError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("ambiguous") ||
    lower.includes("check_and_log_api_usage")
  );
}

/** Rate-limit AI extract calls using service role (avoids broken user RPC on older DBs). */
export async function checkAndLogExtractUsage(
  userId: string,
  organizationId: string,
  endpoint: "extract-contract" | "extract-document",
  maxPerHour = EXTRACT_MAX_PER_ORG_PER_HOUR,
): Promise<{ allowed: true } | { allowed: false; message: string; status: number }> {
  const admin = getAdminClient();
  if (!admin) {
    return { allowed: true };
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error: countError } = await admin
    .from("api_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("endpoint", endpoint)
    .gt("created_at", since);

  if (countError) {
    if (isRateLimitSchemaError(countError.message)) {
      return { allowed: true };
    }
    return { allowed: false, message: countError.message, status: 500 };
  }

  if ((count ?? 0) >= maxPerHour) {
    return {
      allowed: false,
      message: `Rate limit exceeded: ${maxPerHour} AI extractions per hour for this workspace. Try again later.`,
      status: 429,
    };
  }

  const { error: insertError } = await admin.from("api_usage_log").insert({
    organization_id: organizationId,
    endpoint,
    user_id: userId,
  });

  if (insertError) {
    if (isRateLimitSchemaError(insertError.message)) {
      return { allowed: true };
    }
    return { allowed: false, message: insertError.message, status: 500 };
  }

  return { allowed: true };
}
