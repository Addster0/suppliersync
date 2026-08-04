import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createCheckoutSession, createPortalSession } from "../api/billing";
import { useOrganization } from "../contexts/OrganizationContext";
import { fetchIsPlatformAdmin } from "../api/foundingApplication";
import {
  FoundingApplicationAdminPanel,
  FoundingApplicationSection,
} from "../components/FoundingApplicationPanel";
import {
  CLINIC_PLAN_FEATURES,
  formatMonthlyPrice,
  getCheckoutPaymentLink,
  getLockedPriceCents,
  getPlanLabel,
  getTrialDaysRemaining,
  FOUNDING_PRICE_CENTS,
  isCharterOrganization,
  isOnActiveTrial,
  isPastDue,
  isStripeConfigured,
  isSubscriptionActive,
  STANDARD_PRICE_CENTS,
  STRIPE_PORTAL_URL,
  TRIAL_DAYS,
} from "../lib/stripe";

const CHECKOUT_POLL_MS = 2000;
const CHECKOUT_POLL_MAX_ATTEMPTS = 30;

export function BillingPage() {
  const { activeMembership, refreshMemberships } = useOrganization();
  const org = activeMembership?.organization;
  const organizationId = activeMembership?.organizationId ?? "";
  const canManage =
    activeMembership?.role === "owner" || activeMembership?.role === "admin";
  const status = org?.subscriptionStatus ?? "trialing";
  const active = org ? isSubscriptionActive(org) : false;
  const pastDue = org ? isPastDue(org) : false;
  const trialDaysRemaining = org && isOnActiveTrial(org) ? getTrialDaysRemaining(org.trialEndsAt) : null;
  const lockedCents = org ? getLockedPriceCents(org) : STANDARD_PRICE_CENTS;
  const fallbackCheckoutLink = getCheckoutPaymentLink(org);
  const [searchParams, setSearchParams] = useSearchParams();
  const checkoutReturn = searchParams.get("checkout");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [processingPayment, setProcessingPayment] = useState(checkoutReturn === "success" && !active);

  useEffect(() => {
    void fetchIsPlatformAdmin().then(setIsPlatformAdmin);
  }, []);

  const clearCheckoutQuery = useCallback(() => {
    if (!searchParams.has("checkout")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("checkout");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (checkoutReturn !== "success") {
      setProcessingPayment(false);
      return;
    }

    if (active) {
      setProcessingPayment(false);
      clearCheckoutQuery();
      return;
    }

    setProcessingPayment(true);
    let attempts = 0;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      attempts += 1;
      await refreshMemberships();
      if (attempts >= CHECKOUT_POLL_MAX_ATTEMPTS) {
        setProcessingPayment(false);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, CHECKOUT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [checkoutReturn, active, refreshMemberships, clearCheckoutQuery]);

  const handleSubscribe = async () => {
    if (!organizationId || !canManage) return;
    setBillingError(null);
    setCheckoutLoading(true);
    try {
      const url = await createCheckoutSession(organizationId);
      window.location.assign(url);
    } catch (error) {
      if (fallbackCheckoutLink) {
        window.open(fallbackCheckoutLink, "_blank", "noopener,noreferrer");
      } else {
        setBillingError(error instanceof Error ? error.message : "Could not start checkout.");
      }
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleOpenPortal = async () => {
    if (!organizationId || !canManage) return;
    setBillingError(null);
    setPortalLoading(true);
    try {
      const url = await createPortalSession(organizationId);
      window.location.assign(url);
    } catch {
      if (STRIPE_PORTAL_URL) {
        window.open(STRIPE_PORTAL_URL, "_blank", "noopener,noreferrer");
      } else {
        setBillingError("Billing portal is not available yet. Subscribe first or contact support.");
      }
    } finally {
      setPortalLoading(false);
    }
  };

  const showPortal =
    canManage && (active || pastDue || Boolean(STRIPE_PORTAL_URL));

  return (
    <main className="shell billing-shell">
      <section className="content billing-content-wide">
        <header className="topbar">
          <div>
            <p className="eyebrow">Billing</p>
            <h2>Clinic subscription</h2>
            <p className="muted">Manage your SupplierSync plan for {org?.name ?? "this workspace"}.</p>
          </div>
          <span className={`badge ${active ? "active" : pastDue ? "pending" : "expired"}`}>
            {pastDue ? "past due" : status}
          </span>
        </header>

        {processingPayment && (
          <div className="notice billing-notice billing-notice--processing">
            <strong>Processing your payment…</strong>
            <p className="muted small">
              Stripe is confirming checkout. This usually takes a few seconds. You can stay on this page — we will
              refresh automatically.
            </p>
          </div>
        )}

        {checkoutReturn === "canceled" && (
          <div className="notice billing-notice">
            Checkout was canceled. You can subscribe anytime from this page.
          </div>
        )}

        {billingError && (
          <div className="notice billing-notice billing-notice--error">{billingError}</div>
        )}

        {isPlatformAdmin && (
          <>
            <div className="card founding-admin-card platform-admin-links">
              <p className="label">Platform admin</p>
              <p className="muted small">
                See every new account and get email alerts when someone signs up.
              </p>
              <Link className="marketing-button secondary" to="/app/admin/signups">
                View signups
              </Link>
            </div>
            <FoundingApplicationAdminPanel onReviewed={refreshMemberships} />
          </>
        )}

        {org && organizationId && (
          <FoundingApplicationSection
            canManage={canManage}
            isFounding={org.isFounding}
            onApproved={refreshMemberships}
            organizationId={organizationId}
            organizationName={org.name}
          />
        )}

        <div className="card billing-status-card">
          <p className="label">Your plan</p>
          <strong className="billing-plan-name">{org ? getPlanLabel(org) : "Trial"}</strong>
          {trialDaysRemaining != null && (
            <p className="billing-trial-remaining">
              Free trial · {trialDaysRemaining === 1 ? "1 day" : `${trialDaysRemaining} days`} remaining
            </p>
          )}
          <p className="billing-locked-price">{formatMonthlyPrice(lockedCents)}</p>
          {org && isCharterOrganization(org) ? (
            <p className="muted small founding-badge-inline">
              Charter partner rate — locked at {formatMonthlyPrice(lockedCents)} for helping shape the product and
              referrals. Founding clinics pay {formatMonthlyPrice(FOUNDING_PRICE_CENTS)}; new clinics pay standard
              pricing.
            </p>
          ) : org?.isFounding ? (
            <p className="muted small founding-badge-inline">
              Founding clinic rate — locked at {formatMonthlyPrice(lockedCents)} for as long as you stay subscribed.
              New clinics pay standard pricing.
            </p>
          ) : (
            <p className="muted small">
              Standard clinic workspace.
              {org && !org.isFounding ? " Apply for founding pricing above if slots are still available." : ""}
            </p>
          )}
          <p className="muted small">
            {active
              ? trialDaysRemaining != null
                ? `Your ${TRIAL_DAYS}-day free trial is active. Subscribe anytime to keep access after it ends.`
                : "Your workspace is active. Team members can access vendor data."
              : pastDue
                ? "Your last payment failed. Update your payment method in the billing portal to restore access."
                : "Your workspace is locked until billing is updated."}
          </p>
        </div>

        {!isStripeConfigured() && (
          <div className="notice billing-notice">
            Stripe checkout is not fully configured yet. Run <code>./scripts/setup-stripe-webhook.sh</code> and add
            price IDs in Supabase secrets (see <code>.env.example</code>).
          </div>
        )}

        {showPortal && (
          <div className="card billing-portal-card">
            <h3>Manage payment method & invoices</h3>
            <p className="muted small">
              Open the Stripe customer portal to update cards, download invoices, or cancel.
            </p>
            <button
              className="marketing-button secondary billing-link-btn"
              disabled={portalLoading || !canManage}
              onClick={() => void handleOpenPortal()}
              type="button"
            >
              {portalLoading ? "Opening portal…" : "Open billing portal"}
            </button>
          </div>
        )}

        <article className="card billing-plan-card billing-plan-card--single">
          <p className="eyebrow">Clinic workspace</p>
          <h3>{formatMonthlyPrice(lockedCents)}</h3>
          <p className="muted small">Everything you need to run vendor operations for one clinic.</p>
          <ul className="marketing-list">
            {CLINIC_PLAN_FEATURES.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          {canManage ? (
            <button
              className="marketing-button primary billing-link-btn"
              disabled={checkoutLoading || processingPayment}
              onClick={() => void handleSubscribe()}
              type="button"
            >
              {checkoutLoading
                ? "Redirecting to checkout…"
                : processingPayment
                  ? "Processing payment…"
                  : org && isCharterOrganization(org)
                    ? "Subscribe at charter rate"
                    : org?.isFounding
                      ? "Subscribe at founding rate"
                      : "Subscribe"}
            </button>
          ) : (
            <p className="muted small">Ask an owner or admin to manage billing for this workspace.</p>
          )}
          {fallbackCheckoutLink && canManage && (
            <p className="muted small billing-fallback-link">
              Or use{" "}
              <a href={fallbackCheckoutLink} rel="noreferrer" target="_blank">
                legacy payment link
              </a>{" "}
              (does not attach this workspace automatically — prefer Subscribe above).
            </p>
          )}
        </article>
      </section>
    </main>
  );
}
