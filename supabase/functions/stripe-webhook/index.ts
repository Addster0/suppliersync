import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
    case "paused":
      return "incomplete";
    default:
      return status;
  }
}

function resolveOrganizationId(params: {
  metadata?: Stripe.Metadata | null;
  clientReferenceId?: string | null;
}): string | null {
  const fromMetadata = params.metadata?.organization_id?.trim();
  if (fromMetadata) return fromMetadata;

  const fromReference = params.clientReferenceId?.trim();
  if (fromReference) return fromReference;

  return null;
}

async function findOrganizationId(
  admin: ReturnType<typeof createClient>,
  params: {
    organizationId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  }
): Promise<string | null> {
  if (params.organizationId) {
    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("id", params.organizationId)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  if (params.stripeCustomerId) {
    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("stripe_customer_id", params.stripeCustomerId)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  if (params.stripeSubscriptionId) {
    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("stripe_subscription_id", params.stripeSubscriptionId)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  return null;
}

async function updateOrganizationBilling(
  admin: ReturnType<typeof createClient>,
  organizationId: string,
  patch: Record<string, unknown>
) {
  const { error } = await admin.from("organizations").update(patch).eq("id", organizationId);
  if (error) {
    throw new Error(`Failed to update organization ${organizationId}: ${error.message}`);
  }
}

async function handleCheckoutSessionCompleted(
  admin: ReturnType<typeof createClient>,
  stripe: Stripe,
  session: Stripe.Checkout.Session
) {
  const organizationId = resolveOrganizationId({
    metadata: session.metadata,
    clientReferenceId: session.client_reference_id,
  });

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  let subscriptionId: string | null =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  if (!subscriptionId && session.id) {
    const expanded = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["subscription"],
    });
    subscriptionId =
      typeof expanded.subscription === "string"
        ? expanded.subscription
        : expanded.subscription?.id ?? null;
  }

  const resolvedOrgId = await findOrganizationId(admin, {
    organizationId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
  });

  if (!resolvedOrgId) {
    console.warn("checkout.session.completed: could not resolve organization", session.id);
    return;
  }

  let subscriptionStatus = "active";
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    subscriptionStatus = mapStripeSubscriptionStatus(subscription.status);
  }

  await updateOrganizationBilling(admin, resolvedOrgId, {
    subscription_status: subscriptionStatus,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    ...(subscriptionStatus === "active" ? { trial_ends_at: null } : {}),
  });
}

async function handleSubscriptionUpdated(
  admin: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription
) {
  const organizationId = resolveOrganizationId({
    metadata: subscription.metadata,
    clientReferenceId: null,
  });

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const resolvedOrgId = await findOrganizationId(admin, {
    organizationId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
  });

  if (!resolvedOrgId) {
    console.warn("customer.subscription.updated: could not resolve organization", subscription.id);
    return;
  }

  const subscriptionStatus = mapStripeSubscriptionStatus(subscription.status);

  await updateOrganizationBilling(admin, resolvedOrgId, {
    subscription_status: subscriptionStatus,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    ...(subscriptionStatus === "active" ? { trial_ends_at: null } : {}),
  });
}

async function handleSubscriptionDeleted(
  admin: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription
) {
  const organizationId = resolveOrganizationId({ metadata: subscription.metadata });

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const resolvedOrgId = await findOrganizationId(admin, {
    organizationId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
  });

  if (!resolvedOrgId) {
    console.warn("customer.subscription.deleted: could not resolve organization", subscription.id);
    return;
  }

  await updateOrganizationBilling(admin, resolvedOrgId, {
    subscription_status: "canceled",
    stripe_subscription_id: null,
  });
}

async function handleInvoicePaymentFailed(
  admin: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice
) {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;

  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id ?? null;

  const resolvedOrgId = await findOrganizationId(admin, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
  });

  if (!resolvedOrgId) {
    console.warn("invoice.payment_failed: could not resolve organization", invoice.id);
    return;
  }

  await updateOrganizationBilling(admin, resolvedOrgId, {
    subscription_status: "past_due",
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecretKey || !webhookSecret) {
    return jsonResponse(
      {
        error:
          "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set. Run scripts/setup-stripe-webhook.sh.",
      },
      500
    );
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase environment is not configured." }, 500);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse({ error: "Missing stripe-signature header." }, 400);
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-01-27.acacia" });
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook signature.";
    console.error("Stripe webhook signature verification failed:", message);
    return jsonResponse({ error: message }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(
          admin,
          stripe,
          event.data.object as Stripe.Checkout.Session
        );
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(admin, event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(admin, event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(admin, event.data.object as Stripe.Invoice);
        break;
      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handler failed.";
    console.error(message);
    return jsonResponse({ error: message }, 500);
  }

  return jsonResponse({ received: true });
});
