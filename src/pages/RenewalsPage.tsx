import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRenewalEmailStatus, sendDigestTest, sendRenewalReminderTest, setAnnualDigestEnabled, setMonthlyDigestEnabled, setRenewalRemindersEnabled } from "../api/renewalReminders";
import type { RenewalEmailStatus } from "../api/renewalReminders";
import { fetchHandledRenewals, fetchVendors, setRenewalHandled } from "../api/vendors";
import { NeedsAttentionPanel } from "../components/NeedsAttentionPanel";
import { RenewalLossCalculator } from "../components/RenewalLossCalculator";
import { ItemFilterChips } from "../components/ItemFilterChips";
import { RenewalRow, RenewalsEmptyState } from "../components/RenewalRow";
import { useAuth } from "../contexts/AuthContext";
import { useOrganization } from "../contexts/OrganizationContext";
import { MAIN_CONTENT_ID } from "../lib/a11y";
import { openClinicReport } from "../lib/clinicReport";
import { openDigestReportPreview } from "../lib/digestReport";
import { RENEWAL_LOOKAHEAD_DAYS, buildOpenRenewalsFromVendors, urgencyLabel } from "../lib/renewals";
import { getMedianContractValue } from "../lib/renewalLossCalculator";
import { requireSupabase } from "../lib/supabase";
import type { RenewalItem, RenewalUrgency, Vendor } from "../types";

const GROUP_ORDER: RenewalUrgency[] = ["overdue", "soon", "upcoming"];
type RenewalListFilter = "open" | "handled";

export function RenewalsSummary({
  organizationId,
  compact = false,
  medianContractValue = 0,
  vendors: vendorsProp,
}: {
  organizationId: string;
  compact?: boolean;
  medianContractValue?: number;
  /** When provided, build the list from the same vendor contracts as the Contracts tab. */
  vendors?: Vendor[];
}) {
  const [fetchedVendors, setFetchedVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(!vendorsProp);

  useEffect(() => {
    if (vendorsProp) {
      setLoading(false);
      return;
    }
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    void fetchVendors(organizationId)
      .then((data) => {
        if (!cancelled) setFetchedVendors(data);
      })
      .catch(() => {
        if (!cancelled) setFetchedVendors([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, vendorsProp]);

  const items = useMemo(
    () => buildOpenRenewalsFromVendors(vendorsProp ?? fetchedVendors),
    [vendorsProp, fetchedVendors],
  );

  if (loading) {
    return compact ? null : <p className="muted small">Loading renewals…</p>;
  }

  if (items.length === 0) {
    return compact ? null : <RenewalsEmptyState />;
  }

  const preview = compact ? items.slice(0, 3) : items;
  const overdueCount = items.filter((item) => item.urgency === "overdue").length;
  const soonCount = items.filter((item) => item.urgency === "soon").length;

  return (
    <section className={`renewals-summary${compact ? " renewals-summary--compact" : ""}`}>
      <div className="renewals-summary-header">
        <div>
          <p className="eyebrow">Upcoming renewals</p>
          {!compact && (
              <p className="muted small">
                Contracts with renewal or review dates in the next {RENEWAL_LOOKAHEAD_DAYS} days, plus any
                unhandled overdue or expired contracts.
              </p>
          )}
          {compact && (
            <p className="muted small">
              {items.length} contract{items.length === 1 ? "" : "s"} need attention
              {overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
              {soonCount > 0 ? ` · ${soonCount} due within 30 days` : ""}
            </p>
          )}
        </div>
        {compact && (
          <div className="renewals-summary-links">
            <Link className="renewals-view-all" to="/app/renewals#needs-attention">
              Needs attention
            </Link>
            <Link className="renewals-view-all" to="/app/renewals">
              View all
            </Link>
          </div>
        )}
      </div>
      <div className="renewals-list">
        {preview.map((item) => (
          <RenewalRow key={item.contractId} item={item} medianContractValue={medianContractValue} />
        ))}
      </div>
      {compact && items.length > 3 && (
        <Link className="renewals-view-all renewals-view-all--footer" to="/app/renewals">
          View all {items.length} renewals
        </Link>
      )}
    </section>
  );
}

export function RenewalsPage() {
  const { user } = useAuth();
  const { activeMembership, refreshMemberships } = useOrganization();
  const organizationId = activeMembership?.organizationId ?? "";
  const org = activeMembership?.organization;
  const canManageReminders =
    activeMembership?.role === "owner" || activeMembership?.role === "admin";
  const canMarkHandled = activeMembership?.role !== "viewer";
  const [handledItems, setHandledItems] = useState<RenewalItem[]>([]);
  const [listFilter, setListFilter] = useState<RenewalListFilter>("open");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [error, setError] = useState("");
  const [remindersEnabled, setRemindersEnabled] = useState(org?.renewalRemindersEnabled ?? true);
  const [monthlyDigestEnabled, setMonthlyDigestEnabledState] = useState(org?.monthlyDigestEnabled ?? true);
  const [annualDigestEnabled, setAnnualDigestEnabledState] = useState(org?.annualDigestEnabled ?? true);
  const [savingReminders, setSavingReminders] = useState(false);
  const [savingMonthlyDigest, setSavingMonthlyDigest] = useState(false);
  const [savingAnnualDigest, setSavingAnnualDigest] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingMonthlyDigestTest, setSendingMonthlyDigestTest] = useState(false);
  const [sendingAnnualDigestTest, setSendingAnnualDigestTest] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailStatus, setEmailStatus] = useState<RenewalEmailStatus | null>(null);
  const [emailStatusError, setEmailStatusError] = useState("");
  const [renewalNotificationEmail, setRenewalNotificationEmail] = useState<string | null>(null);
  const [loadingNotificationEmail, setLoadingNotificationEmail] = useState(true);

  const loginEmail = user?.email?.trim() || null;
  const overrideEmail = renewalNotificationEmail?.trim() || null;
  const testRecipientEmails = Array.from(
    new Set(
      [loginEmail, overrideEmail].filter((email): email is string => Boolean(email)).map((email) => email)
    )
  );
  const testRecipientEmail = testRecipientEmails[0] ?? null;
  const testRecipientLabel =
    testRecipientEmails.length === 0
      ? null
      : testRecipientEmails.length === 1
        ? testRecipientEmails[0]
        : `${testRecipientEmails.join(" and ")}`;

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setRenewalNotificationEmail(null);
      setLoadingNotificationEmail(false);
      return;
    }

    let cancelled = false;

    async function loadNotificationEmail() {
      const { data, error: profileError } = await requireSupabase()
        .from("profiles")
        .select("renewal_notification_email")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;
      if (profileError) {
        setRenewalNotificationEmail(null);
      } else {
        setRenewalNotificationEmail(data?.renewal_notification_email ?? null);
      }
      setLoadingNotificationEmail(false);
    }

    setLoadingNotificationEmail(true);
    void loadNotificationEmail();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    void fetchRenewalEmailStatus()
      .then((status) => {
        if (!cancelled) setEmailStatus(status);
      })
      .catch((err) => {
        if (!cancelled) {
          setEmailStatusError(err instanceof Error ? err.message : "Could not load email settings.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  useEffect(() => {
    setRemindersEnabled(org?.renewalRemindersEnabled ?? true);
    setMonthlyDigestEnabledState(org?.monthlyDigestEnabled ?? true);
    setAnnualDigestEnabledState(org?.annualDigestEnabled ?? true);
  }, [org?.renewalRemindersEnabled, org?.monthlyDigestEnabled, org?.annualDigestEnabled, organizationId]);

  useEffect(() => {
    if (!organizationId) {
      setVendors([]);
      setLoadingVendors(false);
      return;
    }
    let cancelled = false;
    setLoadingVendors(true);
    void fetchVendors(organizationId)
      .then((data) => {
        if (!cancelled) setVendors(data);
      })
      .catch(() => {
        if (!cancelled) setVendors([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingVendors(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchHandledRenewals(organizationId)
      .then((handled) => {
        if (!cancelled) setHandledItems(handled);
      })
      .catch((err) => {
        if (!cancelled) {
          setHandledItems([]);
          setError(err instanceof Error ? err.message : "Could not load renewals.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Open renewals come from the same vendor/contract payload as the Contracts tab —
  // never a separate query that can quietly drop expired rows.
  const items = useMemo(() => buildOpenRenewalsFromVendors(vendors), [vendors]);

  async function reloadRenewals() {
    if (!organizationId) return;
    const [handled, vendorData] = await Promise.all([
      fetchHandledRenewals(organizationId),
      fetchVendors(organizationId),
    ]);
    setHandledItems(handled);
    setVendors(vendorData);
  }

  async function handleMarkRenewalHandled(contractId: string, note: string) {
    await setRenewalHandled(contractId, true, note);
    await reloadRenewals();
  }

  async function handleReopenRenewal(contractId: string) {
    await setRenewalHandled(contractId, false);
    await reloadRenewals();
  }

  const grouped = useMemo(() => {
    const map: Record<RenewalUrgency, RenewalItem[]> = {
      overdue: [],
      soon: [],
      upcoming: [],
    };
    for (const item of items) map[item.urgency].push(item);
    return map;
  }, [items]);

  const medianContractValue = useMemo(() => getMedianContractValue(vendors), [vendors]);

  async function handleToggleReminders(nextValue: boolean) {
    if (!organizationId || !canManageReminders) return;

    setSavingReminders(true);
    setEmailError("");
    setEmailMessage("");

    try {
      await setRenewalRemindersEnabled(organizationId, nextValue);
      setRemindersEnabled(nextValue);
      await refreshMemberships();
      setEmailMessage(nextValue ? "Email reminders enabled." : "Email reminders turned off.");
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Could not update reminder settings.");
    } finally {
      setSavingReminders(false);
    }
  }

  async function handleToggleMonthlyDigest(nextValue: boolean) {
    if (!organizationId || !canManageReminders) return;

    setSavingMonthlyDigest(true);
    setEmailError("");
    setEmailMessage("");

    try {
      await setMonthlyDigestEnabled(organizationId, nextValue);
      setMonthlyDigestEnabledState(nextValue);
      await refreshMemberships();
      setEmailMessage(nextValue ? "Monthly reports enabled." : "Monthly reports turned off.");
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Could not update report settings.");
    } finally {
      setSavingMonthlyDigest(false);
    }
  }

  async function handleToggleAnnualDigest(nextValue: boolean) {
    if (!organizationId || !canManageReminders) return;

    setSavingAnnualDigest(true);
    setEmailError("");
    setEmailMessage("");

    try {
      await setAnnualDigestEnabled(organizationId, nextValue);
      setAnnualDigestEnabledState(nextValue);
      await refreshMemberships();
      setEmailMessage(nextValue ? "Annual reports enabled." : "Annual reports turned off.");
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Could not update report settings.");
    } finally {
      setSavingAnnualDigest(false);
    }
  }

  async function handleSendDigestTest(periodType: "monthly" | "annual") {
    if (!organizationId || !canManageReminders) return;

    const setSending =
      periodType === "monthly" ? setSendingMonthlyDigestTest : setSendingAnnualDigestTest;
    setSending(true);
    setEmailError("");
    setEmailMessage("");

    try {
      const result = await sendDigestTest(organizationId, periodType);
      const recipient = result.recipient ?? testRecipientEmail ?? "your inbox";
      const label = periodType === "monthly" ? "Monthly report" : "Annual report";
      let message = `${label} test sent to ${recipient}`;
      if (result.periodLabel) {
        message += ` (${result.periodLabel})`;
      }
      message += ".";
      if (result.deliveryNote) {
        message += ` ${result.deliveryNote}`;
      }
      setEmailMessage(message);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Could not send report test.");
    } finally {
      setSending(false);
    }
  }

  async function handleSendTestEmail() {
    if (!organizationId || !canManageReminders) return;

    setSendingTest(true);
    setEmailError("");
    setEmailMessage("");

    try {
      const result = await sendRenewalReminderTest(organizationId);
      const count = result.contractCount ?? 0;
      const recipients =
        (result.recipients && result.recipients.length > 0
          ? result.recipients
          : result.recipient
            ? [result.recipient]
            : testRecipientEmails) ?? [];
      const recipientLabel = recipients.length > 0 ? recipients.join(" and ") : testRecipientLabel ?? "your inbox";
      let message = `Test email sent to ${recipientLabel}${count ? ` with ${count} contract${count === 1 ? "" : "s"}.` : "."}`;
      if (result.fromEmail) {
        message += ` From: ${result.fromEmail}.`;
      }
      if (result.deliveryNote) {
        message += ` ${result.deliveryNote}`;
      } else if (result.usingSandboxSender) {
        message +=
          " Resend sandbox only delivers to the email on your Resend account unless you verify a sending domain.";
      }
      if (result.appUrl?.includes("localhost")) {
        message += " Email links still point at localhost — set APP_URL in Supabase Edge Function secrets.";
      }
      setEmailMessage(message);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Could not send test email.");
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <main className="shell renewals-shell" id={MAIN_CONTENT_ID}>
        <section className="content renewals-content">
          <header className="topbar">
            <div>
              <p className="eyebrow">Renewals</p>
              <h1>Vendor contract deadlines</h1>
              <p className="muted">
                Track renewal and review dates before auto-renewals or missed notice windows. Owners and admins get
                email reminders at 90, 30, and 7 days out, on the due date, and once when a contract is overdue.
              </p>
            </div>
            <div className="right-actions">
              <RenewalLossCalculator
                disabled={loading || loadingVendors}
                renewals={items}
                vendors={vendors}
              />
              <button
                className="secondary"
                disabled={loading || loadingVendors}
                onClick={() =>
                  openClinicReport({
                    workspaceName: org?.name ?? "Workspace",
                    vendors,
                    renewals: items,
                  })
                }
                type="button"
              >
                Print clinic report
              </button>
            </div>
          </header>

          <NeedsAttentionPanel
            id="needs-attention"
            vendors={vendors}
            renewals={items}
            loading={loading || loadingVendors}
          />

          <section className="card renewals-email-card">
            <div className="renewals-email-header">
              <div>
                <p className="label">Email reminders</p>
                <p className="muted small">
                  Sent to workspace owners and admins when contracts hit reminder windows (90, 30, 7 days, due today).
                </p>
              </div>
              {canManageReminders ? (
                <label className="renewals-toggle-label">
                  <input
                    checked={remindersEnabled}
                    disabled={savingReminders}
                    onChange={(event) => void handleToggleReminders(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{savingReminders ? "Saving…" : remindersEnabled ? "On" : "Off"}</span>
                </label>
              ) : (
                <span className={`badge ${remindersEnabled ? "active" : "expired"}`}>
                  {remindersEnabled ? "Enabled" : "Disabled"}
                </span>
              )}
            </div>

            {!emailStatus?.configured && !emailStatusError && (
              <div className="banner error renewals-email-banner">
                Email sending is not configured yet. Run <code>scripts/setup-renewal-email.sh</code> or add{" "}
                <code>RESEND_API_KEY</code> in Supabase Edge Function secrets.
              </div>
            )}

            {emailStatusError && (
              <div className="banner error renewals-email-banner">{emailStatusError}</div>
            )}

            {emailStatus?.configured && emailStatus.usingSandboxSender && (
              <div className="banner renewals-email-banner renewals-email-banner--warn">
                <strong>Sandbox sender active.</strong> Mail only reaches the inbox tied to your Resend account until
                you verify a domain and set <code>RENEWAL_FROM_EMAIL</code> (e.g.{" "}
                <code>SupplierSync &lt;renewals@yourdomain.com&gt;</code>).
              </div>
            )}

            {emailStatus?.configured && emailStatus.appUrlIsLocal && (
              <div className="banner renewals-email-banner renewals-email-banner--warn">
                <strong>Email links use localhost.</strong> Set <code>APP_URL=https://suppliersync.org</code>{" "}
                in Supabase Edge Function secrets so buttons in emails open your live app.
              </div>
            )}

            {canManageReminders && (
              <div className="renewals-email-actions">
                <p className="muted small renewals-email-note">
                  {loadingNotificationEmail ? (
                    "Loading notification address…"
                  ) : testRecipientLabel ? (
                    <>
                      Reminders for you go to <strong>{testRecipientLabel}</strong>
                      {overrideEmail ? " (login + Account extra inbox)" : " (login email)"}.
                      {" "}
                      <Link to="/app/account">Change in Account</Link>
                    </>
                  ) : (
                    <>
                      No email on file for your account.{" "}
                      <Link to="/app/account">Set a reminder address in Account</Link>
                    </>
                  )}
                </p>
                <button className="secondary" disabled={sendingTest || !testRecipientEmail} onClick={() => void handleSendTestEmail()} type="button">
                  {sendingTest ? "Sending…" : "Send test email"}
                </button>
                <p className="muted small renewals-email-note">
                  Preview uses the same list as this page (next {RENEWAL_LOOKAHEAD_DAYS} days). Does not affect live
                  reminder scheduling.
                </p>
              </div>
            )}

            {emailMessage && (
              <div className="banner success renewals-email-banner" role="status" aria-live="polite">
                {emailMessage}
              </div>
            )}
            {emailError && (
              <div className="banner error renewals-email-banner" role="alert">
                {emailError}
              </div>
            )}
          </section>

          <section className="card renewals-email-card">
            <div className="renewals-email-header">
              <div>
                <p className="label">Monthly vendor report</p>
                <p className="muted small">
                  On the 1st of each month, owners and admins receive a visual report with spend trends,
                  category breakdown, top vendors, and scorecard rankings.
                </p>
              </div>
              {canManageReminders ? (
                <label className="renewals-toggle-label">
                  <input
                    checked={monthlyDigestEnabled}
                    disabled={savingMonthlyDigest}
                    onChange={(event) => void handleToggleMonthlyDigest(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{savingMonthlyDigest ? "Saving…" : monthlyDigestEnabled ? "On" : "Off"}</span>
                </label>
              ) : (
                <span className={`badge ${monthlyDigestEnabled ? "active" : "expired"}`}>
                  {monthlyDigestEnabled ? "Enabled" : "Disabled"}
                </span>
              )}
            </div>

            {canManageReminders && (
              <div className="renewals-email-actions">
                <button
                  className="secondary"
                  disabled={sendingMonthlyDigestTest || !testRecipientEmail}
                  onClick={() => void handleSendDigestTest("monthly")}
                  type="button"
                >
                  {sendingMonthlyDigestTest
                    ? "Sending…"
                    : testRecipientEmail
                      ? `Send monthly report test to ${testRecipientEmail}`
                      : "Send monthly report test"}
                </button>
                <button
                  className="secondary"
                  disabled={loading || loadingVendors}
                  onClick={() =>
                    openDigestReportPreview({
                      workspaceName: org?.name ?? "Workspace",
                      vendors,
                      periodType: "monthly",
                    })
                  }
                  type="button"
                >
                  Preview monthly report
                </button>
              </div>
            )}
          </section>

          <section className="card renewals-email-card">
            <div className="renewals-email-header">
              <div>
                <p className="label">Annual vendor report</p>
                <p className="muted small">
                  Every January 1, owners and admins receive a year-in-review report with YoY spend trends,
                  category mix, and vendor scorecard rankings.
                </p>
              </div>
              {canManageReminders ? (
                <label className="renewals-toggle-label">
                  <input
                    checked={annualDigestEnabled}
                    disabled={savingAnnualDigest}
                    onChange={(event) => void handleToggleAnnualDigest(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{savingAnnualDigest ? "Saving…" : annualDigestEnabled ? "On" : "Off"}</span>
                </label>
              ) : (
                <span className={`badge ${annualDigestEnabled ? "active" : "expired"}`}>
                  {annualDigestEnabled ? "Enabled" : "Disabled"}
                </span>
              )}
            </div>

            {canManageReminders && (
              <div className="renewals-email-actions">
                <button
                  className="secondary"
                  disabled={sendingAnnualDigestTest || !testRecipientEmail}
                  onClick={() => void handleSendDigestTest("annual")}
                  type="button"
                >
                  {sendingAnnualDigestTest
                    ? "Sending…"
                    : testRecipientEmail
                      ? `Send annual report test to ${testRecipientEmail}`
                      : "Send annual report test"}
                </button>
                <button
                  className="secondary"
                  disabled={loading || loadingVendors}
                  onClick={() =>
                    openDigestReportPreview({
                      workspaceName: org?.name ?? "Workspace",
                      vendors,
                      periodType: "annual",
                    })
                  }
                  type="button"
                >
                  Preview annual report
                </button>
                <p className="muted small renewals-email-note">
                  Schedule the edge function with <code>mode: monthly_cron</code> and{" "}
                  <code>mode: annual_cron</code> (see RENEWAL_EMAIL_SETUP.md).
                </p>
              </div>
            )}
          </section>

          {error && (
            <div className="banner error" role="alert">
              {error}
            </div>
          )}

          <ItemFilterChips
            value={listFilter}
            onChange={setListFilter}
            options={[
              { value: "open", label: "Open", count: items.length },
              { value: "handled", label: "Handled", count: handledItems.length },
            ]}
          />

          {loading && loadingVendors && <p className="muted">Loading renewals…</p>}
          {!loading && !loadingVendors && listFilter === "open" && items.length === 0 && !error && (
            <RenewalsEmptyState />
          )}
          {!loading && listFilter === "handled" && handledItems.length === 0 && !error && (
            <RenewalsEmptyState handled />
          )}

          {!loading &&
            !loadingVendors &&
            listFilter === "open" &&
            GROUP_ORDER.map((urgency) =>
              grouped[urgency].length ? (
                <section className="renewals-group" key={urgency}>
                  <h3 className="renewals-group-title">{urgencyLabel(urgency)}</h3>
                  <div className="renewals-list">
                    {grouped[urgency].map((item) => (
                      <RenewalRow
                        key={item.contractId}
                        item={item}
                        medianContractValue={medianContractValue}
                        canMarkHandled={canMarkHandled}
                        onMarkHandled={handleMarkRenewalHandled}
                      />
                    ))}
                  </div>
                </section>
              ) : null
            )}

          {!loading && listFilter === "handled" && handledItems.length > 0 && (
            <section className="renewals-group">
              <h3 className="renewals-group-title">Handled renewals</h3>
              <div className="renewals-list">
                {handledItems.map((item) => (
                  <RenewalRow
                    key={item.contractId}
                    handled
                    item={item}
                    medianContractValue={medianContractValue}
                    canMarkHandled={canMarkHandled}
                    onReopen={handleReopenRenewal}
                  />
                ))}
              </div>
            </section>
          )}
        </section>
      </main>
  );
}
