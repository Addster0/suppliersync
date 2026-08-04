import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { fetchIsPlatformAdmin } from "../api/foundingApplication";
import { BrandLogo } from "./BrandLogo";
import { StorageSetupBanner } from "./StorageSetupBanner";
import { useOrganization } from "../contexts/OrganizationContext";
import { useSetupOptional } from "../contexts/SetupContext";

import { getTrialDaysRemaining, isOnActiveTrial } from "../lib/stripe";
import { ProfileMenu } from "./ProfileMenu";

type AppPath = "/app" | "/app/renewals" | "/app/billing" | "/app/account" | "/outreach";

function tabActive(pathname: string, path: AppPath) {
  if (path === "/app") {
    return pathname === "/app" || pathname === "/app/";
  }
  return pathname === path || pathname.endsWith(path);
}

export function AppChrome({ children }: { children: ReactNode }) {
  const { activeMembership, canWrite } = useOrganization();
  const setup = useSetupOptional();
  const { pathname } = useLocation();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    void fetchIsPlatformAdmin().then(setIsPlatformAdmin);
  }, []);

  const org = activeMembership?.organization;
  const trialDaysRemaining =
    org && isOnActiveTrial(org) ? getTrialDaysRemaining(org.trialEndsAt) : null;

  return (
    <div className="app-chrome">
      {trialDaysRemaining != null && (
        <div className="banner trial-banner">
          <span>
            Free trial · {trialDaysRemaining === 1 ? "1 day" : `${trialDaysRemaining} days`} left —{" "}
            <Link to="/app/billing">subscribe</Link> before access ends.
          </span>
        </div>
      )}
      <header className="app-topbar">
        <div className="app-topbar-brand">
          <BrandLogo variant="nav" linkTo="/app" />
          {activeMembership && (
            <span className="app-topbar-workspace">{activeMembership.organization.name}</span>
          )}
        </div>

        <nav className="app-topbar-tabs" aria-label="Main sections">
          <Link className={`app-topbar-tab${tabActive(pathname, "/app") ? " is-active" : ""}`} to="/app">
            Vendors
          </Link>
          <Link
            className={`app-topbar-tab${tabActive(pathname, "/app/renewals") ? " is-active" : ""}`}
            to="/app/renewals"
          >
            Renewals
          </Link>
          <Link
            className={`app-topbar-tab${tabActive(pathname, "/app/billing") ? " is-active" : ""}`}
            to="/app/billing"
          >
            Billing
          </Link>
          <Link
            className={`app-topbar-tab${tabActive(pathname, "/app/account") ? " is-active" : ""}`}
            to="/app/account"
          >
            Account
          </Link>
          {isPlatformAdmin && (
            <Link
              className={`app-topbar-tab outreach-nav-tab${tabActive(pathname, "/outreach") ? " is-active" : ""}`}
              to="/outreach"
            >
              Outreach
            </Link>
          )}
        </nav>

        <div className="app-topbar-actions">
          {setup && canWrite && !setup.loading && !setup.isComplete && (
            <button className="setup-chip" onClick={setup.openSetup} type="button">
              Setup · {setup.completedCount}/{setup.totalSteps}
            </button>
          )}
          <ProfileMenu />
        </div>
      </header>
      <StorageSetupBanner />
      {children}
    </div>
  );
}
