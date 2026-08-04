import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { BrandLogo } from "./BrandLogo";
import { ProfileMenu } from "./ProfileMenu";

export function OutreachChrome({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="app-chrome">
      <header className="app-topbar outreach-topbar">
        <div className="app-topbar-brand">
          <BrandLogo variant="nav" linkTo="/outreach" />
          <span className="app-topbar-workspace outreach-workspace-label">Outreach CRM</span>
        </div>

        <nav className="app-topbar-tabs" aria-label="Outreach sections">
          <Link
            className={`app-topbar-tab${pathname === "/outreach" ? " is-active" : ""}`}
            to="/outreach"
          >
            CRM
          </Link>
          <Link className="app-topbar-tab" to="/app">
            Clinic app
          </Link>
        </nav>

        <div className="app-topbar-actions">
          <ProfileMenu showBilling={false} />
        </div>
      </header>
      {children}
    </div>
  );
}
