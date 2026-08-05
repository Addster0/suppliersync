import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { fetchIsPlatformAdmin } from "../api/foundingApplication";
import { BrandLogo } from "./BrandLogo";
import { StorageSetupBanner } from "./StorageSetupBanner";
import { useOrganization } from "../contexts/OrganizationContext";
import { useSetupOptional } from "../contexts/SetupContext";

import { getTrialDaysRemaining, isOnActiveTrial } from "../lib/stripe";
import { MAIN_CONTENT_ID } from "../lib/a11y";
import { ProfileMenu } from "./ProfileMenu";

type AppPath = "/app" | "/app/renewals" | "/app/account" | "/outreach";

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
      <a className="skip-link" href={`#${MAIN_CONTENT_ID}`}>
        Skip to main content
      </a>
      {trialDaysRemaining != null && (
        <div className="banner trial-banner">
          <span>
            Free trial · {trialDaysRemaining === 1 ? "1 day" : `${trialDaysRemaining} days`} left —{" "}
            <Link to="/app/account?section=billing">subscribe</Link> before access ends.
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
          <Link
            aria-current={tabActive(pathname, "/app") ? "page" : undefined}
            className={`app-topbar-tab${tabActive(pathname, "/app") ? " is-active" : ""}`}
            to="/app"
          >
            Vendors
          </Link>
          <Link
            aria-current={tabActive(pathname, "/app/renewals") ? "page" : undefined}
            className={`app-topbar-tab${tabActive(pathname, "/app/renewals") ? " is-active" : ""}`}
            to="/app/renewals"
          >
            Renewals
          </Link>
          <Link
            aria-current={tabActive(pathname, "/app/account") ? "page" : undefined}
            className={`app-topbar-tab${tabActive(pathname, "/app/account") ? " is-active" : ""}`}
            to="/app/account"
          >
            Account
          </Link>
          {isPlatformAdmin && (
            <Link
              aria-current={tabActive(pathname, "/outreach") ? "page" : undefined}
              className={`app-topbar-tab outreach-nav-tab${tabActive(pathname, "/outreach") ? " is-active" : ""}`}
              to="/outreach"
            >
              Outreach
            </Link>
          )}
        </nav>

        <div className="app-topbar-actions">
          {setup && canWrite && !setup.loading && !setup.isComplete && (
            <button
              aria-label={`Resume workspace setup, ${setup.completedCount} of ${setup.totalSteps} steps complete`}
              className="setup-chip"
              onClick={setup.openSetup}
              type="button"
            >
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
