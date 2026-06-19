import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { BrandLogo } from "./BrandLogo";
import { useAuth } from "../contexts/AuthContext";
import { useOrganization } from "../contexts/OrganizationContext";
import { useSetupOptional } from "../contexts/SetupContext";

type AppPath = "/app" | "/app/renewals" | "/app/billing" | "/app/account";

function tabActive(pathname: string, path: AppPath) {
  if (path === "/app") {
    return pathname === "/app" || pathname === "/app/";
  }
  return pathname === path || pathname.endsWith(path);
}

export function AppChrome({ children }: { children: ReactNode }) {
  const { signOut, user } = useAuth();
  const { activeMembership, canWrite } = useOrganization();
  const setup = useSetupOptional();
  const { pathname } = useLocation();

  return (
    <div className="app-chrome">
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
        </nav>

        <div className="app-topbar-actions">
          {setup && canWrite && !setup.loading && !setup.isComplete && (
            <button className="setup-chip" onClick={setup.openSetup} type="button">
              Setup · {setup.completedCount}/{setup.totalSteps}
            </button>
          )}
          <span className="app-topbar-email" title={user?.email ?? ""}>
            {user?.email}
          </span>
          <button type="button" className="secondary app-topbar-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
