import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { removeOrgStoragePrefix } from "../_shared/storageCleanup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireAuthenticatedUser(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return { error: jsonResponse({ error: "Supabase environment is not configured." }, 500) };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
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

  const admin = createClient(supabaseUrl, serviceRoleKey);
  return { admin, user, userClient };
}

async function soleOwnerOrgIds(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: memberships, error } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  const ownedOrgIds = (memberships ?? [])
    .filter((membership) => membership.role === "owner")
    .map((membership) => membership.organization_id);

  for (const orgId of ownedOrgIds) {
    const { count, error: countError } = await admin
      .from("organization_members")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId);

    if (countError) {
      throw new Error(countError.message);
    }

    if ((count ?? 0) > 1) {
      return {
        blocked: true as const,
        message:
          "You own a workspace with other members. Transfer ownership or delete that workspace first.",
      };
    }
  }

  return { blocked: false as const, orgIds: ownedOrgIds };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const auth = await requireAuthenticatedUser(req);
  if (auth.error) return auth.error;

  const { admin, user, userClient } = auth;

  try {
    const ownership = await soleOwnerOrgIds(admin!, user!.id);
    if (ownership.blocked) {
      return jsonResponse({ error: ownership.message }, 409);
    }

    for (const orgId of ownership.orgIds) {
      await removeOrgStoragePrefix(admin!, orgId);
    }

    const { error: rpcError } = await userClient!.rpc("delete_my_account");
    if (rpcError) {
      return jsonResponse({ error: rpcError.message }, 400);
    }

    const { error: deleteUserError } = await admin!.auth.admin.deleteUser(user!.id);
    if (deleteUserError) {
      return jsonResponse({ error: deleteUserError.message }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account deletion failed.";
    return jsonResponse({ error: message }, 500);
  }
});
