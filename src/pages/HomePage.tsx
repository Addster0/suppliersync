import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { LegalFooter } from "../components/LegalFooter";
import { APP_NAME } from "../lib/brand";
import {
  CLINIC_PLAN_FEATURES,
  fetchFoundingProgramStatus,
  formatMonthlyPrice,
  type FoundingProgramStatus,
} from "../lib/stripe";
import { isSupabaseConfigured } from "../lib/supabase";

const pains = [
  {
    icon: "calendar",
    title: "Renewals sneak up",
    body: "Lab, IT, billing, and cleaning contracts auto-renew while price increases go unnoticed until it's too late.",
  },
  {
    icon: "shield",
    title: "Compliance docs scattered",
    body: "BAAs, insurance certificates, and W-9s live in email threads and folders — hard to find before an audit.",
  },
  {
    icon: "layers",
    title: "No vendor command center",
    body: "Contacts, contracts, notes, and spend live in different places. Nobody has the full picture.",
  },
];

const features = [
  { icon: "vendor", title: "Vendor records", body: "Labs, IT, billing, cleaning, and waste — one list per clinic." },
  { icon: "contract", title: "Contracts & renewals", body: "Start dates, end dates, and values before auto-renew hits." },
  { icon: "doc", title: "Compliance documents", body: "BAAs, COIs, and vendor files without shared-drive chaos." },
  { icon: "spend", title: "Spend tracker", body: "Compare vendor spend — not accounting software." },
  { icon: "search", title: "Workspace search", body: "Find vendors, contracts, contacts, and documents instantly." },
  { icon: "team", title: "Team access", body: "Owners, admins, and staff — each role sees what they need." },
];

const steps = [
  { n: "1", title: "Create your clinic workspace", body: "Sign up and name your practice. Data stays isolated and secure." },
  { n: "2", title: "Add the vendors you already use", body: "Contacts, contracts, documents, and spend in one place." },
  { n: "3", title: "Search and decide before renewals", body: "See what's expiring, what's on file, and what you're spending." },
];

const trustItems = ["Secure workspaces", "Role-based access", "Real database search", "Built for 3–25 staff clinics"];

function MarketingIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    calendar: (
      <path
        d="M8 4V2M16 4V2M4 9h16M6 6h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    ),
    shield: (
      <path
        d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinejoin="round"
      />
    ),
    layers: (
      <>
        <path d="M4 8l8-4 8 4-8 4-8-4z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
        <path d="M4 12l8 4 8-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
      </>
    ),
    vendor: (
      <path
        d="M6 20V10l6-4 6 4v10M9 20v-5h6v5"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinejoin="round"
      />
    ),
    contract: (
      <path
        d="M8 4h8l4 4v12H8V4zm8 0v4h4M10 13h8M10 17h5"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    ),
    doc: (
      <path
        d="M8 4h6l4 4v12H8V4zm6 0v4h4M10 14h8M10 18h6"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    ),
    spend: (
      <path
        d="M5 18V8M10 18V5M15 18v-7M20 18V10"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <path d="M14.5 14.5L19 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <path
          d="M3 19c0-3 2.5-5 6-5s6 2 6 5M16 11a2.5 2.5 0 010 5M19 19c0-2-1.5-3.5-3.5-3.5"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  };

  return (
    <span className="marketing-icon" aria-hidden>
      <svg viewBox="0 0 24 24" width="22" height="22">
        {paths[name]}
      </svg>
    </span>
  );
}

function AppMockup() {
  return (
    <div className="app-mockup" aria-hidden>
      <div className="app-mockup-chrome">
        <span className="app-mockup-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="app-mockup-url">app.suppliersync.com</span>
      </div>
      <div className="app-mockup-body">
        <div className="mock-sidebar">
          <p className="mock-eyebrow">Adeleinc</p>
          <p className="mock-title">{APP_NAME}</p>
          <div className="mock-search">Search workspace…</div>
          <p className="mock-label">My vendors</p>
          <div className="mock-vendor active">
            <strong>Regional Lab Services</strong>
            <small>Lab &amp; diagnostics</small>
          </div>
          <div className="mock-vendor">
            <strong>Clinic IT Support</strong>
            <small>IT services</small>
          </div>
          <div className="mock-vendor">
            <strong>Medical Waste Co.</strong>
            <small>Waste disposal</small>
          </div>
        </div>
        <div className="mock-main">
          <div className="mock-topbar">
            <div>
              <p className="mock-eyebrow">Vendor detail</p>
              <strong>Regional Lab Services</strong>
            </div>
            <span className="mock-badge active">active</span>
          </div>
          <div className="mock-tabs">
            <span>contacts</span>
            <span className="on">contracts</span>
            <span>spend</span>
            <span>documents</span>
          </div>
          <div className="mock-card highlight">
            <small>Renewal in 18 days</small>
            <strong>2026 Lab services agreement</strong>
            <span>Ends Mar 31 · $48,000</span>
          </div>
          <div className="mock-card">
            <small>BAA on file</small>
            <strong>insurance-baa-2026.pdf</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomePage() {
  const [founding, setFounding] = useState<FoundingProgramStatus | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void fetchFoundingProgramStatus().then(setFounding);
  }, []);

  const slotsOpen = (founding?.slotsRemaining ?? 0) > 0;
  const foundingPrice = formatMonthlyPrice(founding?.foundingPriceCents ?? 7900);
  const standardPrice = formatMonthlyPrice(founding?.standardPriceCents ?? 11900);

  return (
    <div className="marketing">
      <header className="marketing-nav">
        <div className="marketing-nav-inner">
          <BrandLogo variant="nav" linkTo="/" />
          <nav className="marketing-nav-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#built-for">Built for</a>
            <Link to="/login">Sign in</Link>
            <Link className="marketing-cta-link" to="/signup">
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <p className="marketing-pill">Vendor operations for private medical clinics</p>
          <h1>
            One calm place for every vendor your clinic depends on.
          </h1>
          <p className="marketing-lead">
            Track vendors, contracts, compliance documents, and spend — without replacing your EHR or your
            accountant. Built for office managers at independent clinics with 3–25 staff.
          </p>
          <div className="marketing-hero-actions">
            <Link className="marketing-button primary" to="/signup">
              Create clinic workspace
            </Link>
            <Link className="marketing-button secondary" to="/login">
              Sign in
            </Link>
            <a className="marketing-button secondary light" href="#pricing">
              See pricing
            </a>
          </div>
          <p className="muted small marketing-hero-pricing-hint">
            After you sign in, use the top menu: <strong>Billing & plan</strong> and <strong>My account</strong>.
          </p>
          <ul className="marketing-trust">
            {trustItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="marketing-hero-visual">
          <AppMockup />
          <p className="marketing-visual-caption muted small">
            The real app stays this simple — sidebar, search, vendor details.
          </p>
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-band-inner">
          <blockquote>
            “We don&apos;t need another complicated system. We need to know what renews, what&apos;s on file, and
            what we&apos;re spending — before it surprises us.”
          </blockquote>
          <p className="muted small">— The problem every private clinic office manager describes</p>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-section-header center">
          <p className="eyebrow">The problem</p>
          <h2>Clinics don&apos;t struggle to find vendors. They struggle to manage them.</h2>
        </div>
        <div className="marketing-grid three">
          {pains.map((item) => (
            <article className="marketing-card lift" key={item.title}>
              <MarketingIcon name={item.icon} />
              <h3>{item.title}</h3>
              <p className="muted">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section marketing-steps" id="how">
        <div className="marketing-section-header">
          <p className="eyebrow">How it works</p>
          <h2>Up and running in minutes — not weeks.</h2>
        </div>
        <div className="marketing-steps-grid">
          {steps.map((step) => (
            <article className="marketing-step" key={step.n}>
              <span className="marketing-step-num">{step.n}</span>
              <h3>{step.title}</h3>
              <p className="muted">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" id="features">
        <div className="marketing-section-header center">
          <p className="eyebrow">What you get</p>
          <h2>Everything your clinic needs in one workspace.</h2>
          <p className="muted marketing-section-copy">
            Same easy layout you&apos;ll use every day — organized for renewals, compliance, and spend decisions.
          </p>
        </div>
        <div className="marketing-grid three">
          {features.map((item) => (
            <article className="marketing-card lift" key={item.title}>
              <MarketingIcon name={item.icon} />
              <h3>{item.title}</h3>
              <p className="muted">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section marketing-split" id="built-for">
        <div className="marketing-card marketing-built lift">
          <p className="eyebrow">Built for</p>
          <h2>Independent private clinics — not hospital procurement.</h2>
          <p className="muted">
            Best for small and mid-size outpatient practices with an office manager who handles renewals,
            vendor contacts, and compliance paperwork every week.
          </p>
          <ul className="marketing-list">
            <li>Primary care and specialty groups (2–10 providers)</li>
            <li>Urgent care and outpatient clinics with recurring vendor spend</li>
            <li>Teams using spreadsheets, email, and shared folders today</li>
            <li>Clinics that want visibility before the next renewal surprise</li>
          </ul>
        </div>
        <div className="marketing-card marketing-not lift">
          <p className="eyebrow">Clear positioning</p>
          <h3>What this is not</h3>
          <ul className="marketing-not-chips">
            <li>Not an EHR</li>
            <li>Not accounting software</li>
            <li>Not procurement</li>
            <li>Not your bookkeeper</li>
          </ul>
          <p className="muted small">
            A decision tool: fewer surprises, faster lookups, smarter renewals.
          </p>
        </div>
      </section>

      <section className="marketing-section" id="pricing">
        <div className="marketing-section-header center">
          <p className="eyebrow">Pricing</p>
          <h2>One workspace per clinic.</h2>
          <p className="muted marketing-section-copy">
            {slotsOpen ? (
              <>
                <strong>{founding?.slotsRemaining ?? 0} founding clinic slots left</strong> — lock in {foundingPrice}{" "}
                for life while you stay subscribed. After that, new clinics pay {standardPrice}.
              </>
            ) : (
              <>Founding slots are full. New clinics start at {standardPrice}.</>
            )}
          </p>
        </div>
        <div className="marketing-pricing-row">
          {slotsOpen && (
            <article className="marketing-card lift marketing-card--founding">
              <p className="eyebrow">Founding clinic · limited</p>
              <h3>{foundingPrice}</h3>
              <p className="muted">First {founding?.maxSlots ?? 5} clinics only. Rate locked for your workspace.</p>
              <ul className="marketing-list">
                {CLINIC_PLAN_FEATURES.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link className="marketing-button primary" to="/signup">
                Claim founding slot
              </Link>
            </article>
          )}
          <article className="marketing-card lift">
            <p className="eyebrow">{slotsOpen ? "Standard" : "Clinic workspace"}</p>
            <h3>{standardPrice}</h3>
            <p className="muted">Full vendor operations for one private clinic workspace.</p>
            <ul className="marketing-list">
              {CLINIC_PLAN_FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <Link className="marketing-button secondary" to="/signup">
              {slotsOpen ? "Sign up (standard rate)" : "Get started"}
            </Link>
          </article>
        </div>
        <p className="muted small center founding-fine-print">
          Founding price applies when you create a workspace while slots remain. Existing founding clinics keep their
          locked rate if we raise prices later.
        </p>
      </section>

      <section className="marketing-section">
        <div className="marketing-cta">
          <div className="marketing-cta-glow" aria-hidden />
          <div className="marketing-cta-content">
            <p className="eyebrow">Get started</p>
            <h2>Give your clinic one place for vendors, contracts, and spend.</h2>
            <p className="muted">
              Create a secure workspace today. Add your real vendors and see why office managers love how
              straightforward it is.
            </p>
          </div>
          <div className="marketing-cta-actions">
            <Link className="marketing-button primary" to="/signup">
              Start free
            </Link>
            <Link className="marketing-button secondary light" to="/login">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer className="marketing-footer">
        <BrandLogo variant="footer" linkTo={null} />
        <p className="muted small">Secure vendor operations for private medical clinics</p>
        <LegalFooter className="marketing-legal-footer" />
      </footer>
    </div>
  );
}
