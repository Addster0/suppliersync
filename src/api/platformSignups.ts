import { requireSupabase } from "../lib/supabase";

export type PlatformSignup = {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
};

export async function fetchPlatformSignups(limit = 100): Promise<PlatformSignup[]> {
  const { data, error } = await requireSupabase().rpc("list_platform_signups", {
    p_limit: limit,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, string>) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    createdAt: row.created_at,
  }));
}
