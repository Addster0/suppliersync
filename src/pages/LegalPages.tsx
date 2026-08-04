import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { LegalFooter } from "../components/LegalFooter";
import {
  LEGAL_LAST_UPDATED,
  PRIVACY_LAST_UPDATED,
  PRIVACY_SECTIONS,
  TERMS_SECTIONS,
  TERMS_VERSION,
} from "../lib/legal";

function LegalDocument({
  title,
  intro,
  sections,
  lastUpdated = LEGAL_LAST_UPDATED,
}: {
  title: string;
  intro: string;
  sections: typeof TERMS_SECTIONS;
  lastUpdated?: string;
}) {
  return (
    <div className="legal-page">
      <header className="legal-page-nav">
        <BrandLogo variant="nav" linkTo="/" />
        <Link className="auth-layout-home" to="/">
          ← Back to home
        </Link>
      </header>

      <main className="legal-page-main card">
        <p className="eyebrow">Legal</p>
        <h1>{title}</h1>
        <p className="muted small legal-page-meta">
          Last updated {lastUpdated}
          {title === "Terms of Service" ? ` · Version ${TERMS_VERSION}` : ""}
        </p>
        <p className="legal-page-intro">{intro}</p>

        <div className="legal-sections">
          {sections.map((section) => (
            <section className="legal-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets && (
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <LegalFooter className="legal-page-footer" />
      </main>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalDocument
      intro="Please read these Terms carefully before using SupplierSync. They describe your rights and responsibilities when using the Service."
      sections={TERMS_SECTIONS}
      title="Terms of Service"
    />
  );
}

export function PrivacyPage() {
  return (
    <LegalDocument
      intro="This Privacy Policy describes how SupplierSync handles information when clinics and their staff use the Service."
      lastUpdated={PRIVACY_LAST_UPDATED}
      sections={PRIVACY_SECTIONS}
      title="Privacy Policy"
    />
  );
}
