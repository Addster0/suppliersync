import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import { requireSupabase } from "../lib/supabase";

async function functionInvokeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    try {
      const payload = (await error.context.clone().json()) as { error?: string; message?: string };
      if (typeof payload?.error === "string" && payload.error.trim()) {
        return payload.error;
      }
      if (typeof payload?.message === "string" && payload.message.trim()) {
        return payload.message;
      }
    } catch {
      // Response body was not JSON.
    }

    if (error.context.status === 404) {
      return "Stripe billing is not deployed. Run ./scripts/setup-stripe-webhook.sh.";
    }
    if (error.context.status === 401) {
      return "Sign in again to manage billing.";
    }
    if (error.context.status === 403) {
      return "Only owners and admins can manage billing.";
    }
  }

  if (error instanceof FunctionsFetchError) {
    return "Cannot reach Supabase edge functions. Check your connection and try again.";
  }

  if (error instanceof FunctionsRelayError) {
    return "Supabase could not run the billing function. Try again in a moment.";
  }

  if (error instanceof Error && error.message !== "Edge Function returned a non-2xx status code") {
    return error.message;
  }

  return "Billing request failed.";
}

const STRIPE_REDIRECT_HOSTS = new Set([
  "checkout.stripe.com",
  "billing.stripe.com",
  "pay.stripe.com",
]);

export function assertStripeRedirectUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid billing redirect URL.");
  }

  if (parsed.protocol !== "https:" || !STRIPE_REDIRECT_HOSTS.has(parsed.hostname)) {
    throw new Error("Invalid billing redirect URL.");
  }

  return url;
}

async function invokeBillingFunction(
  functionName: "create-checkout-session" | "create-portal-session",
  organizationId: string
): Promise<string> {
  const { data, error } = await requireSupabase().functions.invoke(functionName, {
    body: { organizationId },
  });

  if (error) {
    throw new Error(await functionInvokeErrorMessage(error));
  }

  const url = (data as { url?: string } | null)?.url;
  if (!url?.trim()) {
    throw new Error("Billing service did not return a redirect URL.");
  }

  return assertStripeRedirectUrl(url.trim());
}

export async function createCheckoutSession(organizationId: string): Promise<string> {
  return invokeBillingFunction("create-checkout-session", organizationId);
}

export async function createPortalSession(organizationId: string): Promise<string> {
  return invokeBillingFunction("create-portal-session", organizationId);
}
