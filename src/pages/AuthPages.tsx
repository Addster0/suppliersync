import { FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { useAuth } from "../contexts/AuthContext";
import { useOrganization } from "../contexts/OrganizationContext";
import { LegalFooter } from "../components/LegalFooter";
import { acceptTerms } from "../api/profile";
import { APP_TAGLINE } from "../lib/brand";
import { LEGAL_LAST_UPDATED, TERMS_VERSION } from "../lib/legal";
import { fetchFoundingProgramStatus, formatMonthlyPrice, isTrialExpired } from "../lib/stripe";
import { isSupabaseConfigured, type SupabaseConfigIssue } from "../lib/supabase";

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
        <p className="auth-inline-link">
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const result = await requestPasswordReset(email.trim());
    if (result.error) {
      setError(result.error);
    } else {
      setMessage(
        "Check your email. If an account exists for that address, we sent a link to reset your password."
      );
    }
    setLoading(false);
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your work email and we’ll send a secure reset link."
      footer={
        <>
          Remember your password? <Link to="/login">Sign in</Link>
        </>
      }
    >
      {message ? (
        <>
          <p className="auth-success">{message}</p>
          <p className="muted small">
            Didn&apos;t get it? Check spam, or{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMessage("");
                setError("");
              }}
            >
              try another email
            </button>
            .
          </p>
        </>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "Sending link…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { recoveryMode, session, loading: authLoading, updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const canReset = Boolean(session && recoveryMode);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError("");
    const result = await updatePassword(password);
    if (result.error) {
      setError(result.error);
    } else {
      setDone(true);
    }
    setLoading(false);
  }

  if (authLoading) {
    return (
      <AuthShell
        title="Verifying reset link"
        subtitle="Hang on while we confirm your reset link."
        footer={
          <>
            <Link to="/login">Back to sign in</Link>
          </>
        }
      >
        <p className="muted small">This usually takes just a moment.</p>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell
        title="Password updated"
        subtitle="Your new password is saved. You can sign in with it now."
        footer={
          <>
            <Link to="/app">Go to workspace</Link>
          </>
        }
      >
        <Link className="marketing-button primary auth-submit-link" to="/app">
          Continue to app
        </Link>
      </AuthShell>
    );
  }

  if (!canReset) {
    return (
      <AuthShell
        title="Reset link expired"
        subtitle="Open the reset link from your email, or request a new one."
        footer={
          <>
            <Link to="/forgot-password">Request a new link</Link>
            {" · "}
            <Link to="/login">Sign in</Link>
          </>
        }
      >
        <p className="muted small">
          Reset links expire after a short time. If you already updated your password, try signing in.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Enter a new password for your account."
      footer={
        <>
          <Link to="/login">Back to sign in</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? "Saving…" : "Update password"}
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

const CONFIG_ISSUE_COPY: Record<SupabaseConfigIssue, { title: string; body: ReactNode }> = {
  missing: {
    title: "Connect Supabase",
    body: (
      <>
        Copy <code>.env.example</code> to <code>.env.local</code>, add your Supabase URL and anon key, then restart{" "}
        <code>npm run dev</code>.
      </>
    ),
  },
  invalid_url: {
    title: "Fix Supabase URL",
    body: (
      <>
        <code>VITE_SUPABASE_URL</code> in <code>.env.local</code> must look like{" "}
        <code>https://your-project-ref.supabase.co</code>. Copy it from Supabase → Project Settings → API.
      </>
    ),
  },
  invalid_anon_key: {
    title: "Fix Supabase anon key",
    body: (
      <>
        <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code> must be the anon or publishable key from Supabase
        → Project Settings → API (legacy JWT starting with <code>eyJ</code>, or publishable key starting with{" "}
        <code>sb_pub</code> / <code>sb_publishable_</code>).
      </>
    ),
  },
};

export function ConfigRequiredPage({ issues = ["missing"] }: { issues?: SupabaseConfigIssue[] }) {
  const primaryIssue = issues[0] ?? "missing";
  const copy = CONFIG_ISSUE_COPY[primaryIssue];

  return (
    <div className="auth-layout auth-layout--centered">
      <div className="auth-card">
        <BrandLogo variant="auth" linkTo={null} />
        <p className="eyebrow">Setup required</p>
        <h1>{copy.title}</h1>
        <p className="muted small">{copy.body}</p>
        <p className="muted small">
          After updating env vars, run the SQL migrations in <code>supabase/migrations/</code> from the Supabase SQL
          editor.
        </p>
        <Link className="marketing-button primary auth-submit-link" to="/">
          Back to home
        </Link>
      </div>
    </div>
  );
}

export function SupabaseUnreachablePage() {
  return (
    <div className="auth-layout auth-layout--centered">
      <div className="auth-card">
        <BrandLogo variant="auth" linkTo={null} />
        <p className="eyebrow">Connection problem</p>
        <h1>Cannot reach Supabase</h1>
        <p className="muted small">
          The app could not connect to your Supabase project. Common causes:
        </p>
        <ul className="auth-promo-list">
          <li>Free-tier project paused after inactivity — restore it in the Supabase dashboard</li>
          <li>Project deleted or wrong <code>VITE_SUPABASE_URL</code> in <code>.env.local</code></li>
          <li>Dev server started before env vars were saved — restart with <code>npm run dev</code></li>
        </ul>
        <p className="muted small">
          In Supabase → Project Settings → API, confirm the project URL resolves and copy fresh URL + anon key values.
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
      <p className="muted small auth-outreach-link">
        Doing outreach first?{" "}
        <Link to="/outreach">Open your personal outreach CRM</Link> — no workspace required.
      </p>
    </AuthShell>
  );
}

export function TermsAcceptancePage({ onAccepted }: { onAccepted: () => void }) {
  const { user, signOut } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user || !accepted) {
      setError("Please agree to the Terms of Service and Privacy Policy.");
      return;
    }
    setLoading(true);
    setError("");
    const result = await acceptTerms(user.id);
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    onAccepted();
  }

  return (
    <div className="auth-layout auth-layout--centered">
      <div className="auth-card">
        <BrandLogo variant="auth" linkTo="/" />
        <p className="eyebrow">Terms of Service</p>
        <h1>Review and accept</h1>
        <p className="muted small">
          Please review our Terms of Service (updated {LEGAL_LAST_UPDATED}) and accept them to
          continue using SupplierSync.
        </p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="legal-consent">
            <input
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
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
          <button type="submit" className="auth-submit" disabled={loading || !accepted}>
            {loading ? "Saving…" : "I agree — continue"}
          </button>
        </form>
        <p className="auth-footer">
          <button
            type="button"
            className="auth-text-button"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </button>
        </p>
        <LegalFooter className="auth-legal-footer" />
      </div>
    </div>
  );
}

export function SubscriptionBlockedPage() {
  const { activeMembership } = useOrganization();
  const org = activeMembership?.organization;
  const trialExpired = org ? isTrialExpired(org) : false;

  return (
    <div className="auth-layout auth-layout--centered">
      <div className="auth-card">
        <BrandLogo variant="auth" linkTo="/" />
        <p className="eyebrow">Subscription</p>
        <h1>{trialExpired ? "Free trial ended" : "Workspace access paused"}</h1>
        <p className="muted small">
          {trialExpired
            ? "Your 14-day free trial has ended. Subscribe to restore access for your team."
            : "Your clinic subscription is inactive. Update billing to restore access for your team."}
        </p>
        <Link className="marketing-button primary auth-submit-link" to="/app/billing">
          {trialExpired ? "Subscribe now" : "Manage billing"}
        </Link>
        <Link className="marketing-button secondary auth-submit-link" to="/app/account">
          My account
        </Link>
      </div>
    </div>
  );
}
