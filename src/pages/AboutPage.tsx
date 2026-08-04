import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { LegalFooter } from "../components/LegalFooter";
import { APP_NAME, APP_TAGLINE } from "../lib/brand";

export function AboutPage() {
  return (
    <div className="about-page">
      <header className="about-page-nav">
        <BrandLogo variant="nav" linkTo="/" />
        <Link className="auth-layout-home" to="/">
          SupplierSync home
        </Link>
      </header>

      <main className="about-page-main card">
        <div className="about-hero">
          <div className="about-avatar" aria-hidden>
            AO
          </div>
          <div>
            <p className="eyebrow">Founder</p>
            <h1>Addie Oswin</h1>
            <p className="about-tagline muted">Building tools for independent clinics</p>
          </div>
        </div>

        <section className="about-section">
          <h2>About</h2>
          <p>
            I help private medical clinics run smoother vendor operations — contracts, renewals, compliance
            docs, and spend — without another complicated system. Replace this paragraph with your own story,
            background, and what you care about.
          </p>
        </section>

        <section className="about-section">
          <h2>What I&apos;m building</h2>
          <p>
            <strong>{APP_NAME}</strong> — {APP_TAGLINE.toLowerCase()}. One calm workspace where office managers
            track every vendor the clinic depends on, see renewals before they auto-renew, and keep BAAs and
            insurance certificates in one searchable place.
          </p>
          <p className="muted">
            Also exploring <strong>VISO</strong> — vendor intelligence for clinic teams. More soon.
          </p>
        </section>

        <section className="about-section about-cta-block">
          <h2>Try {APP_NAME}</h2>
          <p className="muted">
            Free to start. Built for independent clinics with 3–25 staff — not hospital procurement.
          </p>
          <div className="about-actions">
            <Link className="marketing-button primary" to="/signup">
              Create clinic workspace
            </Link>
            <Link className="marketing-button secondary" to="/">
              Learn more
            </Link>
          </div>
        </section>

        <p className="about-contact muted small">
          {/* Customize: add your email, LinkedIn, or phone */}
          Questions? Reach out at{" "}
          <a href="mailto:hello@example.com">hello@example.com</a>
        </p>

        <LegalFooter className="legal-page-footer" />
      </main>
    </div>
  );
}
