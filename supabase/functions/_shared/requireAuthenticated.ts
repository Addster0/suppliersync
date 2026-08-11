import { createClient, type User } from "npm:@supabase/supabase-js@2";

type AuthResult =
  | { user: User }
  | { error: Response };

export async function requireAuthenticatedUser(
  req: Request,
  corsHeaders: Record<string, string>,
  jsonResponse: (body: Record<string, unknown>, status?: number) => Response
): Promise<AuthResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    return { error: jsonResponse({ error: "Supabase environment is not configured." }, 500) };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: jsonResponse({ error: "Unauthorized." }, 401) };
  }

  const token = authHeader.slice(7).trim();
  if (!token || token === anonKey) {
    return { error: jsonResponse({ error: "Unauthorized." }, 401) };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return { error: jsonResponse({ error: "Unauthorized." }, 401) };
  }

  return { user };
}
