import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deleteAccount, deleteOrganization } from "../api/account";
import { downloadOrganizationExport, exportOrganizationData } from "../api/export";
import { fetchIsPlatformAdmin } from "../api/foundingApplication";
import { useAuth } from "../contexts/AuthContext";
import { useOrganization } from "../contexts/OrganizationContext";
import { useSetup } from "../contexts/SetupContext";
import { LegalFooter } from "../components/LegalFooter";
import { SystemHealthPanel } from "../components/SystemHealthPanel";
import { TERMS_VERSION } from "../lib/legal";
import { formatMonthlyPrice, getLockedPriceCents, getPlanLabel, getTrialDaysRemaining, isOnActiveTrial, isSubscriptionActive } from "../lib/stripe";
import { requireSupabase } from "../lib/supabase";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function AccountPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { activeMembership, memberships, refreshMemberships } = useOrganization();
  const { isComplete, completedCount, totalSteps, openSetup } = useSetup();
  const [fullName, setFullName] = useState("");
  const [renewalNotificationEmail, setRenewalNotificationEmail] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [termsAcceptedAt, setTermsAcceptedAt] = useState<string | null>(null);
  const [termsVersion, setTermsVersion] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [deleteOrgConfirm, setDeleteOrgConfirm] = useState("");
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState("");
  const [deletingOrg, setDeletingOrg] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void fetchIsPlatformAdmin().then(setIsPlatformAdmin);
  }, []);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;
    let cancelled = false;

    async function loadProfile() {
      setLoadingProfile(true);
      const { data, error: profileError } = await requireSupabase()
        .from("profiles")
        .select("full_name, email, terms_accepted_at, terms_version, renewal_notification_email")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;
      if (profileError) {
        setError(profileError.message);
      } else {
        setFullName(data?.full_name ?? (user?.user_metadata?.full_name as string) ?? "");
        setRenewalNotificationEmail(data?.renewal_notification_email ?? "");
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

    const trimmedRenewalEmail = renewalNotificationEmail.trim();
    if (trimmedRenewalEmail && !isValidEmail(trimmedRenewalEmail)) {
      setError("Enter a valid renewal reminder email, or leave the field blank.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    const { error: updateError } = await requireSupabase()
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        renewal_notification_email: trimmedRenewalEmail || null,
      })
      .eq("id", user.id);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage("Profile updated.");
  }

  const org = activeMembership?.organization;
  const isOwner = activeMembership?.role === "owner";
  const orgName = org?.name ?? "";
  const orgDeletePhrase = orgName ? `delete ${orgName}` : "";

  async function handleExportWorkspace() {
    if (!org || !isOwner) return;

    setExporting(true);
    setError("");
    setMessage("");

    try {
      const data = await exportOrganizationData(org.id);
      downloadOrganizationExport(data);
      setMessage(`Exported ${data.vendors.length} vendor record${data.vendors.length === 1 ? "" : "s"} as JSON.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export workspace data.");
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteWorkspace() {
    if (!org || !isOwner) return;

    const confirmed = window.confirm(
      `Delete workspace "${org.name}"? All vendors, contracts, documents, and files will be permanently removed. This cannot be undone.`
    );
    if (!confirmed) return;

    if (deleteOrgConfirm.trim().toLowerCase() !== orgDeletePhrase.toLowerCase()) {
      setError(`Type "${orgDeletePhrase}" to confirm workspace deletion.`);
      return;
    }

    setDeletingOrg(true);
    setError("");
    setMessage("");

    try {
      await deleteOrganization(org.id);
      await refreshMemberships();
      setDeleteOrgConfirm("");
      setMessage(`Workspace "${org.name}" was deleted.`);
      navigate("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete workspace.");
    } finally {
      setDeletingOrg(false);
    }
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      "Delete your SupplierSync account permanently? Your profile, outreach CRM data, and any workspaces where you are the only member will be removed. This cannot be undone."
    );
    if (!confirmed) return;

    if (deleteAccountConfirm.trim().toLowerCase() !== "delete my account") {
      setError('Type "delete my account" to confirm account deletion.');
      return;
    }

    setDeletingAccount(true);
    setError("");
    setMessage("");

    try {
      await deleteAccount();
      await signOut();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account.");
      setDeletingAccount(false);
    }
  }

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
                  <label>
                    Renewal reminder email
                    <input
                      type="email"
                      value={renewalNotificationEmail}
                      onChange={(e) => setRenewalNotificationEmail(e.target.value)}
                      placeholder={user?.email ?? "Same as login email"}
                      autoComplete="email"
                    />
                  </label>
                  <p className="muted small">
                    If your signup email doesn&apos;t receive our messages, enter a Gmail or work address here.
                    Leave blank to use your login email ({user?.email ?? "—"}).
                  </p>
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
                {org && !isSubscriptionActive(org) && " (inactive)"}
                {org && isOnActiveTrial(org) && org.trialEndsAt && (
                  <>
                    {" "}
                    · Trial ends{" "}
                    {getTrialDaysRemaining(org.trialEndsAt) === 0
                      ? "today"
                      : `in ${getTrialDaysRemaining(org.trialEndsAt)} days`}
                  </>
                )}
              </p>
              {memberships.length > 1 && (
                <p className="muted small">You belong to {memberships.length} workspaces. Switch workspace in the Vendors sidebar.</p>
              )}
              <Link className="marketing-button primary account-billing-link" to="/app/billing">
                Open billing & plan
              </Link>
            </article>

            {isPlatformAdmin && <SystemHealthPanel />}

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

            {isOwner && org && (
              <article className="card account-data-section">
                <p className="label">Your data</p>
                <p className="muted small">
                  Download a JSON copy of vendor records, contacts, contract and document metadata, spend entries,
                  and evaluations. Uploaded PDF files are not included — only file names and sizes.
                </p>
                <button
                  type="button"
                  className="secondary account-export-button"
                  onClick={() => void handleExportWorkspace()}
                  disabled={exporting || deletingOrg || deletingAccount}
                >
                  {exporting ? "Preparing export…" : "Export workspace data"}
                </button>
              </article>
            )}

            <article className="card account-danger-zone">
              <p className="label">Danger zone</p>
              <p className="muted small">
                Permanently remove workspace data or your entire account. Cancel any active Stripe subscription
                first from billing if applicable.
              </p>

              {isOwner && org && (
                <div className="account-danger-action">
                  <p className="account-danger-title">Delete workspace</p>
                  <p className="muted small">
                    Removes <strong>{org.name}</strong>, all vendors, contracts, uploaded files, and member
                    access. Other members lose access immediately.
                  </p>
                  <label>
                    Type <strong>{orgDeletePhrase}</strong> to confirm
                    <input
                      value={deleteOrgConfirm}
                      onChange={(e) => setDeleteOrgConfirm(e.target.value)}
                      placeholder={orgDeletePhrase}
                      autoComplete="off"
                    />
                  </label>
                  <button
                    type="button"
                    className="delete account-danger-button"
                    onClick={() => void handleDeleteWorkspace()}
                    disabled={deletingOrg || deletingAccount}
                  >
                    {deletingOrg ? "Deleting workspace…" : "Delete workspace"}
                  </button>
                </div>
              )}

              <div className="account-danger-action">
                <p className="account-danger-title">Delete my account</p>
                <p className="muted small">
                  Removes your profile, outreach CRM, and sole-member workspaces. You must transfer ownership or
                  delete shared workspaces first.
                </p>
                <label>
                  Type <strong>delete my account</strong> to confirm
                  <input
                    value={deleteAccountConfirm}
                    onChange={(e) => setDeleteAccountConfirm(e.target.value)}
                    placeholder="delete my account"
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  className="delete account-danger-button"
                  onClick={() => void handleDeleteAccount()}
                  disabled={deletingOrg || deletingAccount}
                >
                  {deletingAccount ? "Deleting account…" : "Delete my account"}
                </button>
              </div>
            </article>
          </div>

          <p className="muted small account-help">
            Need a different clinic workspace? <Link to="/app">Go to vendors</Link> or sign out and create another account.
          </p>
        </section>
      </main>
  );
}
