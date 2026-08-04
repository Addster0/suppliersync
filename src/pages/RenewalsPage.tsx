import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRenewalEmailStatus, sendRenewalReminderTest, sendWeeklyDigestTest, setRenewalRemindersEnabled, setWeeklyDigestEnabled } from "../api/renewalReminders";
import type { RenewalEmailStatus } from "../api/renewalReminders";
import { fetchUpcomingRenewals, fetchHandledRenewals, fetchVendors, setRenewalHandled } from "../api/vendors";
import { NeedsAttentionPanel } from "../components/NeedsAttentionPanel";
import { ItemFilterChips } from "../components/ItemFilterChips";
import { RenewalRow, RenewalsEmptyState } from "../components/RenewalRow";
import { useAuth } from "../contexts/AuthContext";
import { useOrganization } from "../contexts/OrganizationContext";
import { openClinicReport } from "../lib/clinicReport";
import { RENEWAL_LOOKAHEAD_DAYS, RENEWAL_RECENT_EXPIRED_DAYS, urgencyLabel } from "../lib/renewals";
import { requireSupabase } from "../lib/supabase";
import type { RenewalItem, RenewalUrgency, Vendor } from "../types";

const GROUP_ORDER: RenewalUrgency[] = ["overdue", "soon", "upcoming"];
type RenewalListFilter = "open" | "handled";

export function RenewalsSummary({
  organizationId,
  compact = false,
}: {
  organizationId: string;
  compact?: boolean;
}) {
  const [items, setItems] = useState<RenewalItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    void fetchUpcomingRenewals(organizationId)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

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
                Contracts with renewal or review dates in the next {RENEWAL_LOOKAHEAD_DAYS} days or overdue in the last{" "}
                {RENEWAL_RECENT_EXPIRED_DAYS} days.
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
          <RenewalRow key={item.contractId} item={item} />
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
  const [items, setItems] = useState<RenewalItem[]>([]);
  const [handledItems, setHandledItems] = useState<RenewalItem[]>([]);
  const [listFilter, setListFilter] = useState<RenewalListFilter>("open");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [error, setError] = useState("");
  const [remindersEnabled, setRemindersEnabled] = useState(org?.renewalRemindersEnabled ?? true);
  const [digestEnabled, setDigestEnabled] = useState(org?.weeklyDigestEnabled ?? true);
  const [savingReminders, setSavingReminders] = useState(false);
  const [savingDigest, setSavingDigest] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingDigestTest, setSendingDigestTest] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailStatus, setEmailStatus] = useState<RenewalEmailStatus | null>(null);
  const [emailStatusError, setEmailStatusError] = useState("");
  const [renewalNotificationEmail, setRenewalNotificationEmail] = useState<string | null>(null);
  const [loadingNotificationEmail, setLoadingNotificationEmail] = useState(true);

  const testRecipientEmail = renewalNotificationEmail?.trim() || user?.email || null;

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
    setDigestEnabled(org?.weeklyDigestEnabled ?? true);
  }, [org?.renewalRemindersEnabled, org?.weeklyDigestEnabled, organizationId]);

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
    void Promise.all([fetchUpcomingRenewals(organizationId), fetchHandledRenewals(organizationId)])
      .then(([open, handled]) => {
        if (!cancelled) {
          setItems(open);
          setHandledItems(handled);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setItems([]);
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

  async function reloadRenewals() {
    if (!organizationId) return;
    const [open, handled] = await Promise.all([
      fetchUpcomingRenewals(organizationId),
      fetchHandledRenewals(organizationId),
    ]);
    setItems(open);
    setHandledItems(handled);
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

  async function handleToggleDigest(nextValue: boolean) {
    if (!organizationId || !canManageReminders) return;

    setSavingDigest(true);
    setEmailError("");
    setEmailMessage("");

    try {
      await setWeeklyDigestEnabled(organizationId, nextValue);
      setDigestEnabled(nextValue);
      await refreshMemberships();
      setEmailMessage(nextValue ? "Weekly digest enabled." : "Weekly digest turned off.");
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Could not update digest settings.");
    } finally {
      setSavingDigest(false);
    }
  }

  async function handleSendDigestTest() {
    if (!organizationId || !canManageReminders) return;

    setSendingDigestTest(true);
    setEmailError("");
    setEmailMessage("");

    try {
      const result = await sendWeeklyDigestTest(organizationId);
      const count = result.itemCount ?? 0;
      const recipient = result.recipient ?? testRecipientEmail ?? "your inbox";
      let message = `Weekly digest test sent to ${recipient}${count ? ` with ${count} action item${count === 1 ? "" : "s"}.` : "."}`;
      if (result.deliveryNote) {
        message += ` ${result.deliveryNote}`;
      }
      setEmailMessage(message);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Could not send digest test.");
    } finally {
      setSendingDigestTest(false);
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
      const recipient = result.recipient ?? testRecipientEmail ?? "your inbox";
      let message = `Test email sent to ${recipient}${count ? ` with ${count} contract${count === 1 ? "" : "s"}.` : "."}`;
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
    <main className="shell renewals-shell">
        <section className="content renewals-content">
          <header className="topbar">
            <div>
              <p className="eyebrow">Renewals</p>
              <h2>Vendor contract deadlines</h2>
              <p className="muted">
                Track renewal and review dates before auto-renewals or missed notice windows. Owners and admins get
                email digests at 90, 30, and 7 days out, plus on the due date.
              </p>
            </div>
            <div className="right-actions">
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
                  ) : testRecipientEmail ? (
                    <>
                      Reminders for you go to <strong>{testRecipientEmail}</strong>
                      {renewalNotificationEmail?.trim() ? " (override)" : " (login email)"}.
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

            {emailMessage && <div className="banner success renewals-email-banner">{emailMessage}</div>}
            {emailError && <div className="banner error renewals-email-banner">{emailError}</div>}
          </section>

          <section className="card renewals-email-card">
            <div className="renewals-email-header">
              <div>
                <p className="label">Weekly action items digest</p>
                <p className="muted small">
                  Every Monday, owners and admins get a summary of renewals, compliance gaps, and missing contacts.
                </p>
              </div>
              {canManageReminders ? (
                <label className="renewals-toggle-label">
                  <input
                    checked={digestEnabled}
                    disabled={savingDigest}
                    onChange={(event) => void handleToggleDigest(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{savingDigest ? "Saving…" : digestEnabled ? "On" : "Off"}</span>
                </label>
              ) : (
                <span className={`badge ${digestEnabled ? "active" : "expired"}`}>
                  {digestEnabled ? "Enabled" : "Disabled"}
                </span>
              )}
            </div>

            {canManageReminders && (
              <div className="renewals-email-actions">
                <button
                  className="secondary"
                  disabled={sendingDigestTest || !testRecipientEmail}
                  onClick={() => void handleSendDigestTest()}
                  type="button"
                >
                  {sendingDigestTest
                    ? "Sending…"
                    : testRecipientEmail
                      ? `Send weekly digest test to ${testRecipientEmail}`
                      : "Send weekly digest test"}
                </button>
                <p className="muted small renewals-email-note">
                  Uses the same action items as the panel above. Schedule the edge function with{" "}
                  <code>mode: weekly_cron</code> (see RENEWAL_EMAIL_SETUP.md).
                </p>
              </div>
            )}
          </section>

          {error && <div className="banner error">{error}</div>}

          <ItemFilterChips
            value={listFilter}
            onChange={setListFilter}
            options={[
              { value: "open", label: "Open", count: items.length },
              { value: "handled", label: "Handled", count: handledItems.length },
            ]}
          />

          {loading && <p className="muted">Loading renewals…</p>}
          {!loading && listFilter === "open" && items.length === 0 && !error && <RenewalsEmptyState />}
          {!loading && listFilter === "handled" && handledItems.length === 0 && !error && (
            <RenewalsEmptyState handled />
          )}

          {!loading &&
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
