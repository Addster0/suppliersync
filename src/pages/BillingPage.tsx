import { useEffect, useState } from "react";
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
  FOUNDING_PRICE_CENTS,
  isCharterOrganization,
  isStripeConfigured,
  isSubscriptionActive,
  STANDARD_PRICE_CENTS,
  STRIPE_PORTAL_URL,
} from "../lib/stripe";

export function BillingPage() {
  const { activeMembership, refreshMemberships } = useOrganization();
  const org = activeMembership?.organization;
  const organizationId = activeMembership?.organizationId ?? "";
  const canManage =
    activeMembership?.role === "owner" || activeMembership?.role === "admin";
  const status = org?.subscriptionStatus ?? "trialing";
  const active = isSubscriptionActive(status);
  const lockedCents = org ? getLockedPriceCents(org) : STANDARD_PRICE_CENTS;
  const checkoutLink = getCheckoutPaymentLink(org);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    void fetchIsPlatformAdmin().then(setIsPlatformAdmin);
  }, []);

  return (
    <main className="shell billing-shell">
      <section className="content billing-content-wide">
        <header className="topbar">
          <div>
            <p className="eyebrow">Billing</p>
            <h2>Clinic subscription</h2>
            <p className="muted">Manage your SupplierSync plan for {org?.name ?? "this workspace"}.</p>
          </div>
          <span className={`badge ${active ? "active" : "expired"}`}>{status}</span>
        </header>

        {isPlatformAdmin && (
          <FoundingApplicationAdminPanel onReviewed={refreshMemberships} />
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
              ? "Your workspace is active. Team members can access vendor data."
              : "Your workspace is locked until billing is updated."}
          </p>
        </div>

        {!isStripeConfigured() && (
          <div className="notice billing-notice">
            Stripe is not connected yet. Add Payment Link env vars to <code>.env.local</code> (see{" "}
            <code>.env.example</code>).
          </div>
        )}

        {STRIPE_PORTAL_URL && (
          <div className="card billing-portal-card">
            <h3>Manage payment method & invoices</h3>
            <p className="muted small">Open the Stripe customer portal to update cards, download invoices, or cancel.</p>
            <a
              className="marketing-button secondary billing-link-btn"
              href={STRIPE_PORTAL_URL}
              rel="noreferrer"
              target="_blank"
            >
              Open billing portal
            </a>
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
          {checkoutLink ? (
            <a
              className="marketing-button primary billing-link-btn"
              href={checkoutLink}
              rel="noreferrer"
              target="_blank"
            >
              {org && isCharterOrganization(org)
                ? "Subscribe at charter rate"
                : org?.isFounding
                  ? "Subscribe at founding rate"
                  : "Subscribe"}
            </a>
          ) : (
            <p className="muted small">
              Add{" "}
              {org && isCharterOrganization(org)
                ? "VITE_STRIPE_LINK_CHARTER"
                : org?.isFounding
                  ? "VITE_STRIPE_LINK_FOUNDING"
                  : "VITE_STRIPE_LINK_STANDARD"}{" "}
              to enable checkout.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}
