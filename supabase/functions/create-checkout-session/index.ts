import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CHARTER_PRICE_CENTS = 4900;
const FOUNDING_PRICE_CENTS = 7900;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolvePriceId(org: {
  plan: string;
  is_founding: boolean;
  locked_monthly_price_cents: number | null;
}): string | null {
  const charterPriceId = Deno.env.get("STRIPE_PRICE_CHARTER")?.trim();
  const foundingPriceId = Deno.env.get("STRIPE_PRICE_FOUNDING")?.trim();
  const standardPriceId = Deno.env.get("STRIPE_PRICE_STANDARD")?.trim();

  const isCharter =
    org.plan === "charter" || org.locked_monthly_price_cents === CHARTER_PRICE_CENTS;

  if (isCharter && charterPriceId) return charterPriceId;
  if (org.is_founding && foundingPriceId) return foundingPriceId;
  if (standardPriceId) return standardPriceId;
  return foundingPriceId ?? charterPriceId ?? standardPriceId ?? null;
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

  return { admin, user };
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
    .select("id, name, plan, is_founding, locked_monthly_price_cents, stripe_customer_id")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError) {
    return jsonResponse({ error: orgError.message }, 500);
  }

  if (!org) {
    return jsonResponse({ error: "Workspace not found." }, 404);
  }

  const priceId = resolvePriceId(org);
  if (!priceId) {
    return jsonResponse(
      {
        error:
          "Stripe price IDs are not configured. Set STRIPE_PRICE_CHARTER, STRIPE_PRICE_FOUNDING, and STRIPE_PRICE_STANDARD in Supabase secrets.",
      },
      500
    );
  }

  const appUrl = (Deno.env.get("APP_URL") ?? "https://suppliersync.org").replace(/\/$/, "");
  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-01-27.acacia" });

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: organizationId,
    metadata: { organization_id: organizationId },
    subscription_data: {
      metadata: { organization_id: organizationId },
    },
    success_url: `${appUrl}/app/billing?checkout=success`,
    cancel_url: `${appUrl}/app/billing?checkout=canceled`,
    allow_promotion_codes: true,
  };

  if (org.stripe_customer_id) {
    sessionParams.customer = org.stripe_customer_id;
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) {
      return jsonResponse({ error: "Stripe did not return a checkout URL." }, 502);
    }
    return jsonResponse({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create checkout session.";
    return jsonResponse({ error: message }, 502);
  }
});
