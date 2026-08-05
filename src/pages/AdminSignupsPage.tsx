import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { fetchIsPlatformAdmin } from "../api/foundingApplication";
import { fetchPlatformSignups, type PlatformSignup } from "../api/platformSignups";

function formatSignupTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AdminSignupsPage() {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean | null>(null);
  const [signups, setSignups] = useState<PlatformSignup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchIsPlatformAdmin().then(setIsPlatformAdmin);
  }, []);

  useEffect(() => {
    if (!isPlatformAdmin) return;

    setLoading(true);
    setError("");
    void fetchPlatformSignups()
      .then(setSignups)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not load signups.");
        setSignups([]);
      })
      .finally(() => setLoading(false));
  }, [isPlatformAdmin]);

  if (isPlatformAdmin === null) {
    return <p className="muted small">Loading…</p>;
  }

  if (!isPlatformAdmin) {
    return <Navigate to="/app" replace />;
  }

  return (
    <main className="shell billing-shell">
      <section className="content billing-content-wide">
        <header className="topbar">
          <div>
            <p className="eyebrow">Platform admin</p>
            <h2>Recent signups</h2>
            <p className="muted">
              New accounts only — logins are not listed here. Enable email alerts with{" "}
              <code>scripts/setup-signup-notify.sh</code>.
            </p>
          </div>
          <Link className="marketing-button secondary" to="/app/account?section=billing">
            Back to billing
          </Link>
        </header>

        <div className="card founding-admin-card">
          {error && <div className="banner error">{error}</div>}

          {loading ? (
            <p className="muted small">Loading signups…</p>
          ) : signups.length === 0 ? (
            <p className="muted small">No signups yet.</p>
          ) : (
            <>
              <p className="label">{signups.length} account{signups.length === 1 ? "" : "s"}</p>
              <ul className="founding-admin-list platform-signups-list">
                {signups.map((signup) => (
                  <li className="founding-admin-item platform-signup-item" key={signup.id}>
                    <div>
                      <strong>{signup.fullName || signup.email}</strong>
                      {signup.fullName && <p className="muted small">{signup.email}</p>}
                      <p className="muted small">Signed up {formatSignupTime(signup.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
