import { FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { useAuth } from "../contexts/AuthContext";
import { useOrganization } from "../contexts/OrganizationContext";
import { LegalFooter } from "../components/LegalFooter";
import { APP_TAGLINE } from "../lib/brand";
import { TERMS_VERSION } from "../lib/legal";
import { fetchFoundingProgramStatus, formatMonthlyPrice } from "../lib/stripe";
import { isSupabaseConfigured } from "../lib/supabase";

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn(email.trim(), password);
    if (result.error) setError(result.error);
    setLoading(false);
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your clinic workspace."
      footer={
        <>
          No account yet? <Link to="/signup">Create one</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!acceptedTerms) {
      setError("Please agree to the Terms of Service and Privacy Policy.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    const result = await signUp(email.trim(), password, fullName.trim(), {
      version: TERMS_VERSION,
      acceptedAt: new Date().toISOString(),
    });
    if (result.error) {
      setError(result.error);
    } else {
      setMessage("Account created. You can sign in now, or check your email if confirmation is enabled.");
    }
    setLoading(false);
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start organizing vendors, contracts, and spend for your clinic."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
        </label>
        <label>
          Work email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <label className="legal-consent">
          <input
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            required
            type="checkbox"
          />
          <span>
            I agree to the{" "}
            <Link target="_blank" rel="noopener noreferrer" to="/terms">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link target="_blank" rel="noopener noreferrer" to="/privacy">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        {message && <p className="auth-success">{message}</p>}
        <button type="submit" className="auth-submit" disabled={loading || !acceptedTerms}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}

function AuthShell({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="auth-layout">
      <header className="auth-layout-nav">
        <BrandLogo variant="nav" linkTo="/" />
        <Link className="auth-layout-home" to="/">
          ← Back to home
        </Link>
      </header>

      <div className="auth-layout-main">
        <div className="auth-promo">
          <p className="eyebrow">Private clinic vendor ops</p>
          <h2>One workspace for vendors, contracts, compliance files, and spend.</h2>
          <ul className="auth-promo-list">
            <li>Secure, isolated clinic data</li>
            <li>Real search across your records</li>
            <li>Simple enough for office managers</li>
          </ul>
        </div>

        <div className="auth-card">
          <h1>{title}</h1>
          <p className="auth-card-subtitle">{subtitle}</p>
          <p className="auth-card-tagline muted small">{APP_TAGLINE}</p>
          {children}
          <p className="auth-footer">{footer}</p>
          <LegalFooter className="auth-legal-footer" />
        </div>
      </div>
    </div>
  );
}

export function ConfigRequiredPage() {
  return (
    <div className="auth-layout auth-layout--centered">
      <div className="auth-card">
        <BrandLogo variant="auth" linkTo={null} />
        <p className="eyebrow">Setup required</p>
        <h1>Connect Supabase</h1>
        <p className="muted small">
          Copy <code>.env.example</code> to <code>.env.local</code>, add your Supabase URL and anon key, then run{" "}
          <code>supabase/migrations/001_initial_schema.sql</code> in the Supabase SQL editor.
        </p>
        <Link className="marketing-button primary auth-submit-link" to="/">
          Back to home
        </Link>
      </div>
    </div>
  );
}

export function CreateOrganizationPage() {
  const { createOrganization } = useOrganization();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [foundingHint, setFoundingHint] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void fetchFoundingProgramStatus().then((status) => {
      if (!status) return;
      if (status.slotsRemaining > 0) {
        setFoundingHint(
          `${status.slotsRemaining} founding slot${status.slotsRemaining === 1 ? "" : "s"} available — apply on the Billing page after setup to lock in ${formatMonthlyPrice(status.foundingPriceCents)}.`
        );
      } else {
        setFoundingHint(`Founding slots are full. This workspace will use standard pricing (${formatMonthlyPrice(status.standardPriceCents)}).`);
      }
    });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    const result = await createOrganization(name.trim());
    if (result.error) setError(result.error);
    setLoading(false);
  }

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Your clinic gets its own secure vendor data. You’ll be the owner."
      footer="You can invite teammates in a future update."
    >
      {foundingHint && <p className="auth-success">{foundingHint}</p>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Clinic / company name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Adeleinc Medical"
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? "Creating workspace…" : "Create workspace"}
        </button>
      </form>
    </AuthShell>
  );
}

export function SubscriptionBlockedPage() {
  return (
    <div className="auth-layout auth-layout--centered">
      <div className="auth-card">
        <BrandLogo variant="auth" linkTo="/" />
        <p className="eyebrow">Subscription</p>
        <h1>Workspace access paused</h1>
        <p className="muted small">
          Your clinic subscription is inactive. Update billing to restore access for your team.
        </p>
        <Link className="marketing-button primary auth-submit-link" to="/app/billing">
          Manage billing
        </Link>
        <Link className="marketing-button secondary auth-submit-link" to="/app/account">
          My account
        </Link>
      </div>
    </div>
  );
}
