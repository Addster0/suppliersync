import { requireSupabase, isSupabaseConfigValid } from "./supabase";
import type { Organization } from "../types";

/** First N clinics get founding rate; locked in DB while subscribed. */
export const MAX_FOUNDING_CLINICS = 5;
export const TRIAL_DAYS = 14;
/** Design partner / first charter clinic — set manually in Supabase, not auto-assigned. */
export const CHARTER_PRICE_CENTS = 4900;
export const FOUNDING_PRICE_CENTS = 7900;
export const STANDARD_PRICE_CENTS = 11900;

export const CLINIC_PLAN_FEATURES = [
  "Unlimited vendors",
  "Contracts, documents & renewals",
  "Workspace search",
  "Spend tracker",
  "Team roles (owner, admin, member, viewer)",
] as const;

export type FoundingProgramStatus = {
  maxSlots: number;
  claimedSlots: number;
  slotsRemaining: number;
  foundingPriceCents: number;
  standardPriceCents: number;
};

const charterLink = import.meta.env.VITE_STRIPE_LINK_CHARTER as string | undefined;
const foundingLink = import.meta.env.VITE_STRIPE_LINK_FOUNDING as string | undefined;
const standardLink = import.meta.env.VITE_STRIPE_LINK_STANDARD as string | undefined;

/** @deprecated Legacy tier links — prefer founding + standard */
const legacyLinks = {
  starter: import.meta.env.VITE_STRIPE_LINK_STARTER as string | undefined,
  pro: import.meta.env.VITE_STRIPE_LINK_PRO as string | undefined,
  business: import.meta.env.VITE_STRIPE_LINK_BUSINESS as string | undefined,
};

export const STRIPE_PORTAL_URL = import.meta.env.VITE_STRIPE_CUSTOMER_PORTAL_URL as string | undefined;

export function formatMonthlyPrice(priceCents: number) {
  return `$${Math.round(priceCents / 100)}/mo`;
}

export function getLockedPriceCents(org: Organization) {
  if (org.lockedMonthlyPriceCents != null) return org.lockedMonthlyPriceCents;
  return org.isFounding ? FOUNDING_PRICE_CENTS : STANDARD_PRICE_CENTS;
}

export function isCharterOrganization(org: Organization | null | undefined) {
  if (!org) return false;
  return org.plan === "charter" || org.lockedMonthlyPriceCents === CHARTER_PRICE_CENTS;
}

export function getCheckoutPaymentLink(org: Organization | null | undefined): string | null {
  if (isCharterOrganization(org)) {
    if (charterLink?.trim()) return charterLink.trim();
    return null;
  }

  const useFounding = org?.isFounding ?? false;
  const url = useFounding ? foundingLink : standardLink;
  if (url?.trim()) return url.trim();
  return legacyLinks.starter?.trim() ?? null;
}

export function isStripeConfigured() {
  // Checkout and portal run via Supabase edge functions when Stripe secrets are set.
  if (isSupabaseConfigValid) return true;
  return Boolean(
    charterLink?.trim() ||
      foundingLink?.trim() ||
      standardLink?.trim() ||
      legacyLinks.starter?.trim() ||
      STRIPE_PORTAL_URL?.trim()
  );
}

type SubscriptionOrg = Pick<Organization, "subscriptionStatus" | "trialEndsAt">;

export function getTrialDaysRemaining(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function isTrialExpired(org: SubscriptionOrg) {
  return org.subscriptionStatus === "trialing" && getTrialDaysRemaining(org.trialEndsAt) === 0;
}

export function isOnActiveTrial(org: SubscriptionOrg) {
  return org.subscriptionStatus === "trialing" && isSubscriptionActive(org);
}

export function isSubscriptionActive(org: SubscriptionOrg) {
  if (org.subscriptionStatus === "active") return true;
  if (org.subscriptionStatus === "trialing") {
    if (!org.trialEndsAt) return true;
    return new Date(org.trialEndsAt) > new Date();
  }
  return false;
}

export function isPastDue(org: SubscriptionOrg) {
  return org.subscriptionStatus === "past_due";
}

export function getPlanLabel(org: Organization) {
  if (isCharterOrganization(org)) return "Charter partner";
  if (org.isFounding) return "Founding clinic";
  if (org.plan === "standard") return "Clinic workspace";
  return org.plan.charAt(0).toUpperCase() + org.plan.slice(1);
}

export async function fetchFoundingProgramStatus(): Promise<FoundingProgramStatus | null> {
  try {
    const { data, error } = await requireSupabase().rpc("get_founding_program_status");
    if (error || !data || typeof data !== "object") return null;
    const row = data as Record<string, number>;
    return {
      maxSlots: row.max_slots ?? MAX_FOUNDING_CLINICS,
      claimedSlots: row.claimed_slots ?? 0,
      slotsRemaining: row.slots_remaining ?? 0,
      foundingPriceCents: row.founding_price_cents ?? FOUNDING_PRICE_CENTS,
      standardPriceCents: row.standard_price_cents ?? STANDARD_PRICE_CENTS,
    };
  } catch {
    return null;
  }
}
