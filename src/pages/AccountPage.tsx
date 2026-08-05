import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { deleteAccount, deleteOrganization } from "../api/account";
import { downloadOrganizationExport, exportOrganizationData } from "../api/export";
import { downloadOrganizationReport } from "../lib/exportReport";
import { fetchIsPlatformAdmin } from "../api/foundingApplication";
import { useAuth } from "../contexts/AuthContext";
import { useOrganization } from "../contexts/OrganizationContext";
import { useSetup } from "../contexts/SetupContext";
import { LegalFooter } from "../components/LegalFooter";
import { SystemHealthPanel } from "../components/SystemHealthPanel";
import { BillingSection } from "./BillingPage";
import { MAIN_CONTENT_ID } from "../lib/a11y";
import { TERMS_VERSION } from "../lib/legal";
import { formatMonthlyPrice, getLockedPriceCents, getPlanLabel, getTrialDaysRemaining, isOnActiveTrial, isSubscriptionActive } from "../lib/stripe";
import { requireSupabase } from "../lib/supabase";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type AccountSection = "profile" | "workspace" | "billing" | "data" | "legal" | "system" | "danger";

const ACCOUNT_SECTIONS: AccountSection[] = ["profile", "workspace", "billing", "data", "legal", "system", "danger"];

function parseAccountSection(value: string | null): AccountSection | null {
  if (value && ACCOUNT_SECTIONS.includes(value as AccountSection)) {
    return value as AccountSection;
  }
  return null;
}

export function AccountPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionFromUrl = parseAccountSection(searchParams.get("section"));
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
  const [exportingReport, setExportingReport] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [activeSection, setActiveSection] = useState<AccountSection>(sectionFromUrl ?? "profile");
  const fullNameId = useId();
  const renewalEmailId = useId();
  const deleteOrgConfirmId = useId();
  const deleteAccountConfirmId = useId();
  const dangerErrorRef = useRef<HTMLDivElement>(null);
  const [dangerError, setDangerError] = useState("");

  const showDangerError = useCallback((message: string) => {
    setDangerError(message);
    setError(message);
    requestAnimationFrame(() => {
      dangerErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

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

  async function handleExportReport() {
    if (!org) {
      setError("No workspace selected. Switch to a workspace in the sidebar and try again.");
      return;
    }
    if (!isOwner) {
      setError("Only workspace owners can download reports. Ask your workspace owner for a copy.");
      return;
    }

    setExportingReport(true);
    setError("");
    setMessage("");

    try {
      const data = await exportOrganizationData(org.id);
      downloadOrganizationReport(data);
      setMessage(
        `Downloaded workspace report for ${data.vendors.length} vendor${data.vendors.length === 1 ? "" : "s"}. Open the HTML file in your browser, then use Print → Save as PDF if you need a PDF copy.`
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Could not export workspace report.";
      setError(`${detail} If nothing downloaded, check your browser’s download permission for this site.`);
    } finally {
      setExportingReport(false);
    }
  }

  async function handleExportJson() {
    if (!org || !isOwner) return;

    setExportingJson(true);
    setError("");
    setMessage("");

    try {
      const data = await exportOrganizationData(org.id);
      downloadOrganizationExport(data);
      setMessage(`Downloaded advanced JSON export for ${data.vendors.length} vendor record${data.vendors.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export workspace data.");
    } finally {
      setExportingJson(false);
    }
  }

  async function handleDeleteWorkspace() {
    if (!org || !isOwner) return;

    if (deleteOrgConfirm.trim().toLowerCase() !== orgDeletePhrase.toLowerCase()) {
      showDangerError(`Type "${orgDeletePhrase}" in the confirmation box below before deleting.`);
      return;
    }

    const confirmed = window.confirm(
      `Delete workspace "${org.name}"? All vendors, contracts, documents, and files will be permanently removed. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingOrg(true);
    setError("");
    setDangerError("");
    setMessage("");

    try {
      await deleteOrganization(org.id);
      await refreshMemberships();
      setDeleteOrgConfirm("");
      setMessage(`Workspace "${org.name}" was deleted.`);
      navigate("/app");
    } catch (err) {
      showDangerError(err instanceof Error ? err.message : "Could not delete workspace.");
    } finally {
      setDeletingOrg(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteAccountConfirm.trim().toLowerCase() !== "delete my account") {
      showDangerError('Type "delete my account" in the confirmation box below before deleting.');
      return;
    }

    const confirmed = window.confirm(
      "Delete your SupplierSync account permanently? Your profile, outreach CRM data, and any workspaces where you are the only member will be removed. This cannot be undone."
    );
    if (!confirmed) return;

    setDeletingAccount(true);
    setError("");
    setDangerError("");
    setMessage("");

    try {
      await deleteAccount();
      await signOut();
      navigate("/");
    } catch (err) {
      showDangerError(err instanceof Error ? err.message : "Could not delete account.");
      setDeletingAccount(false);
    }
  }

  const subscriptionStatus = org?.subscriptionStatus ?? "trialing";

  const navSections = useMemo(() => {
    const items: { id: AccountSection; label: string; danger?: boolean }[] = [
      { id: "profile", label: "Profile" },
      { id: "workspace", label: "Workspace" },
      { id: "billing", label: "Billing & plan" },
    ];
    if (isOwner && org) {
      items.push({ id: "data", label: "Your data" });
    }
    items.push({ id: "legal", label: "Legal" });
    if (isPlatformAdmin) {
      items.push({ id: "system", label: "System status" });
    }
    items.push({ id: "danger", label: "Danger zone", danger: true });
    return items;
  }, [isOwner, org, isPlatformAdmin]);

  const selectSection = useCallback(
    (section: AccountSection) => {
      setActiveSection(section);
      const next = new URLSearchParams(searchParams);
      if (section === "profile") {
        next.delete("section");
      } else {
        next.set("section", section);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    if (sectionFromUrl && sectionFromUrl !== activeSection) {
      setActiveSection(sectionFromUrl);
    }
  }, [sectionFromUrl, activeSection]);

  useEffect(() => {
    if (!navSections.some((section) => section.id === activeSection)) {
      selectSection(navSections[0]?.id ?? "profile");
    }
  }, [navSections, activeSection, selectSection]);

  return (
    <main className="shell account-shell" id={MAIN_CONTENT_ID}>
      <section className="content account-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Settings</p>
            <h1>Account</h1>
            <p className="muted">Manage your profile, workspace, and data.</p>
          </div>
        </header>

        {message && (
          <div className="banner" role="status" aria-live="polite">
            {message}
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}

        {!isComplete && (
          <div className="banner account-setup-banner">
            Workspace setup is {completedCount}/{totalSteps} complete.{" "}
            <button className="setup-inline-button" onClick={openSetup} type="button">
              Resume setup
            </button>
          </div>
        )}

        <div className="account-settings">
          <nav className="account-settings-nav" aria-label="Account settings sections">
            {navSections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`${activeSection === section.id ? "is-active" : ""}${section.danger ? " danger-nav" : ""}`}
                aria-current={activeSection === section.id ? "page" : undefined}
                onClick={() => selectSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          <div className="account-settings-panel">
            {activeSection === "profile" && (
              <article className="card account-settings-section">
                <h2>Profile</h2>
                <p className="muted small section-lead">Your name and notification preferences.</p>
                {loadingProfile ? (
                  <p className="muted small">Loading profile…</p>
                ) : (
                  <form className="auth-form account-form" onSubmit={handleSave}>
                    <label htmlFor={fullNameId}>
                      Full name
                      <input
                        id={fullNameId}
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                      />
                    </label>
                    <label htmlFor="account-email">
                      Email
                      <input id="account-email" value={user?.email ?? ""} disabled />
                    </label>
                    <p className="muted small">Email is managed by your login and cannot be changed here yet.</p>
                    <label htmlFor={renewalEmailId}>
                      Renewal reminder email
                      <input
                        id={renewalEmailId}
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
            )}

            {activeSection === "workspace" && (
              <article className="card account-settings-section">
                <h2>Workspace</h2>
                <p className="muted small section-lead">Your clinic workspace membership and plan.</p>
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
                  <p className="muted small">
                    You belong to {memberships.length} workspaces. Switch workspace in the Vendors sidebar.
                  </p>
                )}
                <button
                  type="button"
                  className="marketing-button primary account-billing-link"
                  onClick={() => selectSection("billing")}
                >
                  Open billing & plan
                </button>
              </article>
            )}

            {activeSection === "billing" && <BillingSection />}

            {activeSection === "data" && isOwner && org && (
              <article className="card account-settings-section">
                <h2>Your data</h2>
                <p className="muted small section-lead">
                  Download a readable copy of your workspace records.
                </p>
                <p className="muted small">
                  The workspace report includes vendor names, contacts, contract dates and values,
                  renewal details, document metadata, spend entries, and scorecards in a clean HTML
                  document you can open in any browser.
                </p>
                <button
                  type="button"
                  className="marketing-button primary account-export-button"
                  onClick={() => void handleExportReport()}
                  disabled={exportingReport || exportingJson || deletingOrg || deletingAccount}
                >
                  {exportingReport ? "Preparing report…" : "Download workspace report"}
                </button>
                <p className="muted small">
                  Opens as a normal web page — not code. Use your browser&apos;s{" "}
                  <strong>Print → Save as PDF</strong> to create a PDF; Adobe Acrobat is not required.
                  Uploaded PDF files are not included — only file names and sizes.
                </p>
                <button
                  type="button"
                  className="account-advanced-export-link"
                  onClick={() => void handleExportJson()}
                  disabled={exportingReport || exportingJson || deletingOrg || deletingAccount}
                >
                  {exportingJson ? "Preparing JSON…" : "Advanced export (JSON)"}
                </button>
                <p className="muted small">
                  For IT backups or importing into other systems. JSON is machine-readable and not
                  formatted for clinic staff review.
                </p>
              </article>
            )}

            {activeSection === "legal" && (
              <article className="card account-settings-section">
                <h2>Legal</h2>
                <p className="muted small section-lead">Terms acceptance and policy documents.</p>
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
            )}

            {activeSection === "system" && isPlatformAdmin && <SystemHealthPanel />}

            {activeSection === "danger" && (
              <article className="card account-settings-section account-danger-zone">
                <h2>Danger zone</h2>
                <p className="muted small section-lead">
                  Permanently remove workspace data or your entire account. Cancel any active Stripe
                  subscription first from billing if applicable.
                </p>

                {dangerError && (
                  <div
                    ref={dangerErrorRef}
                    className="banner error inline account-danger-error"
                    role="alert"
                    aria-live="assertive"
                  >
                    {dangerError}
                  </div>
                )}

                {isOwner && org && (
                  <div className="account-danger-action">
                    <p className="account-danger-title">Delete workspace</p>
                    <p className="muted small">
                      Removes <strong>{org.name}</strong>, all vendors, contracts, uploaded files, and member
                      access. Other members lose access immediately.
                    </p>
                    <label htmlFor={deleteOrgConfirmId}>
                      Type <strong>{orgDeletePhrase}</strong> to confirm
                      <input
                        id={deleteOrgConfirmId}
                        value={deleteOrgConfirm}
                        onChange={(e) => {
                          setDeleteOrgConfirm(e.target.value);
                          if (dangerError) setDangerError("");
                        }}
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
                    Removes your profile, outreach CRM, and sole-member workspaces. You must transfer ownership
                    or delete shared workspaces first.
                  </p>
                  <label htmlFor={deleteAccountConfirmId}>
                    Type <strong>delete my account</strong> to confirm
                    <input
                      id={deleteAccountConfirmId}
                      value={deleteAccountConfirm}
                      onChange={(e) => {
                        setDeleteAccountConfirm(e.target.value);
                        if (dangerError) setDangerError("");
                      }}
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
            )}
          </div>
        </div>

        <p className="muted small account-help">
          Need a different clinic workspace? <Link to="/app">Go to vendors</Link> or sign out and create another account.
        </p>
      </section>
    </main>
  );
}
