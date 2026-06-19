import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useOrganization } from "../contexts/OrganizationContext";
import { useSetup } from "../contexts/SetupContext";
import { LegalFooter } from "../components/LegalFooter";
import { TERMS_VERSION } from "../lib/legal";
import { formatMonthlyPrice, getLockedPriceCents, getPlanLabel, isSubscriptionActive } from "../lib/stripe";
import { requireSupabase } from "../lib/supabase";

export function AccountPage() {
  const { user } = useAuth();
  const { activeMembership, memberships } = useOrganization();
  const { isComplete, completedCount, totalSteps, openSetup } = useSetup();
  const [fullName, setFullName] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [termsAcceptedAt, setTermsAcceptedAt] = useState<string | null>(null);
  const [termsVersion, setTermsVersion] = useState<string | null>(null);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;
    let cancelled = false;

    async function loadProfile() {
      setLoadingProfile(true);
      const { data, error: profileError } = await requireSupabase()
        .from("profiles")
        .select("full_name, email, terms_accepted_at, terms_version")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;
      if (profileError) {
        setError(profileError.message);
      } else {
        setFullName(data?.full_name ?? (user?.user_metadata?.full_name as string) ?? "");
        setTermsAcceptedAt(
          data?.terms_accepted_at ??
            (user?.user_metadata?.terms_accepted_at as string | undefined) ??
            null
        );
        setTermsVersion(
          data?.terms_version ?? (user?.user_metadata?.terms_version as string | undefined) ?? null
        );
      }
      setLoadingProfile(false);
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    setError("");
    setMessage("");

    const { error: updateError } = await requireSupabase()
      .from("profiles")
      .update({ full_name: fullName.trim() })
      .eq("id", user.id);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage("Profile updated.");
  }

  const org = activeMembership?.organization;
  const subscriptionStatus = org?.subscriptionStatus ?? "trialing";

  return (
    <main className="shell account-shell">
        <section className="content account-content">
          <header className="topbar">
            <div>
              <p className="eyebrow">My account</p>
              <h2>Your profile & workspace</h2>
              <p className="muted">Signed-in user settings for SupplierSync.</p>
            </div>
          </header>

          {message && <div className="banner">{message}</div>}
          {error && <div className="banner error">{error}</div>}

          {!isComplete && (
            <div className="banner account-setup-banner">
              Workspace setup is {completedCount}/{totalSteps} complete.{" "}
              <button className="setup-inline-button" onClick={openSetup} type="button">
                Resume setup
              </button>
            </div>
          )}

          <div className="account-grid">
            <article className="card">
              <p className="label">Profile</p>
              {loadingProfile ? (
                <p className="muted small">Loading profile…</p>
              ) : (
                <form className="auth-form account-form" onSubmit={handleSave}>
                  <label>
                    Full name
                    <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                  </label>
                  <label>
                    Email
                    <input value={user?.email ?? ""} disabled />
                  </label>
                  <p className="muted small">Email is managed by your login and cannot be changed here yet.</p>
                  <button type="submit" className="auth-submit" disabled={saving}>
                    {saving ? "Saving…" : "Save profile"}
                  </button>
                </form>
              )}
            </article>

            <article className="card">
              <p className="label">Clinic workspace</p>
              <p>
                <strong>{org?.name ?? "—"}</strong>
              </p>
              <p className="muted small">
                Role: <strong>{activeMembership?.role ?? "—"}</strong>
              </p>
              <p className="muted small">
                Plan: <strong>{org ? getPlanLabel(org) : "Trial"}</strong> ·{" "}
                {org && (
                  <>
                    <strong>{formatMonthlyPrice(getLockedPriceCents(org))}</strong>
                    {org.isFounding ? " (locked founding rate)" : ""} ·{" "}
                  </>
                )}
                Status: <strong>{subscriptionStatus}</strong>
                {!isSubscriptionActive(subscriptionStatus) && " (inactive)"}
              </p>
              {memberships.length > 1 && (
                <p className="muted small">You belong to {memberships.length} workspaces. Switch workspace in the Vendors sidebar.</p>
              )}
              <Link className="marketing-button primary account-billing-link" to="/app/billing">
                Open billing & plan
              </Link>
            </article>

            <article className="card">
              <p className="label">Legal</p>
              <p className="muted small">
                {termsAcceptedAt ? (
                  <>
                    Terms accepted{" "}
                    {new Date(termsAcceptedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                    {termsVersion ? ` (version ${termsVersion})` : ""}.
                  </>
                ) : (
                  <>Current Terms version: {TERMS_VERSION}.</>
                )}
              </p>
              <LegalFooter />
            </article>
          </div>

          <p className="muted small account-help">
            Need a different clinic workspace? <Link to="/app">Go to vendors</Link> or sign out and create another account.
          </p>
        </section>
      </main>
  );
}
