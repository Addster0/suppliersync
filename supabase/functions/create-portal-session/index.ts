import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

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

async function requireOrgAdmin(req: Request, organizationId: string) {
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
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return { error: jsonResponse({ error: membershipError.message }, 500) };
  }

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { error: jsonResponse({ error: "Only owners and admins can manage billing." }, 403) };
  }

  return { admin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecretKey) {
    return jsonResponse(
      {
        error:
          "STRIPE_SECRET_KEY is not configured. Run scripts/setup-stripe-webhook.sh.",
      },
      500
    );
  }

  let body: { organizationId?: string };
  try {
    body = (await req.json()) as { organizationId?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const organizationId = body.organizationId?.trim();
  if (!organizationId) {
    return jsonResponse({ error: "organizationId is required." }, 400);
  }

  const auth = await requireOrgAdmin(req, organizationId);
  if (auth.error) return auth.error;

  const { data: org, error: orgError } = await auth.admin!
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError) {
    return jsonResponse({ error: orgError.message }, 500);
  }

  if (!org?.stripe_customer_id) {
    return jsonResponse(
      { error: "No Stripe customer on file yet. Subscribe first, then manage billing here." },
      400
    );
  }

  const appUrl = (Deno.env.get("APP_URL") ?? "https://suppliersync.org").replace(/\/$/, "");
  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-01-27.acacia" });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${appUrl}/app/account?section=billing`,
    });
    return jsonResponse({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open billing portal.";
    return jsonResponse({ error: message }, 502);
  }
});
