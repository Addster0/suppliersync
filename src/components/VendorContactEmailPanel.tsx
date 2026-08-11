import { FormEvent, useEffect, useState } from "react";
import {
  fetchVendorEmailMessages,
  fetchVendorEmailStatus,
  sendVendorContactEmail,
  type VendorEmailStatus,
} from "../api/vendorEmail";
import { getSupabaseEdgeSecretsUrl } from "../lib/storage";
import type { Contact, VendorEmailMessage } from "../types";

const CLINIC_EMAIL_UNAVAILABLE =
  "Relationship email temporarily unavailable — ask your SupplierSync admin to enable Resend.";

function VendorEmailSetupHint({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  if (!isPlatformAdmin) {
    return <>{CLINIC_EMAIL_UNAVAILABLE}</>;
  }

  return (
    <>
      Relationship email is not configured. Add <code>RESEND_API_KEY</code> in{" "}
      <a href={getSupabaseEdgeSecretsUrl()} target="_blank" rel="noreferrer">
        Supabase Edge Function secrets
      </a>{" "}
      (or run <code>./scripts/setup-vendor-email.sh</code>). Uses the same Resend key as renewal reminders.
    </>
  );
}

function formatSentAt(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function VendorContactEmailPanel({
  organizationId,
  vendorId,
  contacts,
  readOnly,
  isPlatformAdmin,
}: {
  organizationId: string;
  vendorId: string;
  contacts: Contact[];
  readOnly: boolean;
  isPlatformAdmin: boolean;
}) {
  const emailableContacts = contacts.filter((c) => c.email?.trim());
  const [status, setStatus] = useState<VendorEmailStatus | null>(null);
  const [history, setHistory] = useState<VendorEmailMessage[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [composeContactId, setComposeContactId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function reloadHistory() {
    try {
      const rows = await fetchVendorEmailMessages(organizationId, vendorId);
      setHistory(rows);
      setHistoryError(null);
    } catch (error) {
      setHistory([]);
      setHistoryError(error instanceof Error ? error.message : "Could not load email history.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchVendorEmailStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus({
            configured: false,
            reachable: false,
            error: error instanceof Error ? error.message : "Could not check email status.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchVendorEmailMessages(organizationId, vendorId);
        if (!cancelled) {
          setHistory(rows);
          setHistoryError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setHistory([]);
          setHistoryError(error instanceof Error ? error.message : "Could not load email history.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, vendorId]);

  function openCompose(contactId: string) {
    setComposeContactId(contactId);
    setSubject("");
    setBody("");
    setBanner(null);
  }

  function closeCompose() {
    setComposeContactId(null);
    setSubject("");
    setBody("");
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (readOnly || !composeContactId || sending) return;

    setSending(true);
    setBanner(null);
    try {
      const result = await sendVendorContactEmail({
        organizationId,
        vendorId,
        contactId: composeContactId,
        subject,
        body,
      });

      const note = result.usingSandboxSender
        ? " Sandbox sender: delivery may only reach your Resend account email."
        : "";
      const warning = result.warning ? ` ${result.warning}` : "";
      setBanner({
        kind: "success",
        text: `Email sent to ${result.toName || result.to || "contact"}.${note}${warning}`,
      });
      closeCompose();
      await reloadHistory();
    } catch (error) {
      setBanner({
        kind: "error",
        text: error instanceof Error ? error.message : "Failed to send email.",
      });
    } finally {
      setSending(false);
    }
  }

  const composeContact = emailableContacts.find((c) => c.id === composeContactId) ?? null;
  const configured = status?.configured === true;
  const showSetup = status != null && status.configured === false;

  return (
    <div className="vendor-email-panel">
      <div className="section-header vendor-email-panel__head">
        <h3>Relationship emails</h3>
        <p className="muted">Send from SupplierSync and keep a history on this vendor.</p>
      </div>

      {showSetup && (
        <div className="banner inline">
          <VendorEmailSetupHint isPlatformAdmin={isPlatformAdmin} />
          {status?.error && isPlatformAdmin && status.reachable === false ? (
            <p className="muted" style={{ marginTop: 8 }}>
              {status.error}
            </p>
          ) : null}
        </div>
      )}

      {status?.configured && status.usingSandboxSender && status.deliveryNote && (
        <div className="banner inline">
          <p className="muted" style={{ margin: 0 }}>
            {status.deliveryNote}
          </p>
        </div>
      )}

      {banner && (
        <div className={`banner inline ${banner.kind === "error" ? "error" : "success"}`}>
          {banner.text}
        </div>
      )}

      {!readOnly && emailableContacts.length > 0 && (
        <div className="vendor-email-contact-actions">
          {emailableContacts.map((contact) => (
            <button
              key={contact.id}
              type="button"
              className="vendor-email-send-btn"
              disabled={!configured || sending}
              onClick={() => openCompose(contact.id)}
              title={configured ? `Email ${contact.name}` : "Configure Resend to send email"}
            >
              Email {contact.name}
            </button>
          ))}
        </div>
      )}

      {!readOnly && contacts.length > 0 && emailableContacts.length === 0 && (
        <p className="muted">Add an email address to a contact to send from the app.</p>
      )}

      {composeContact && (
        <form className="form-grid card vendor-email-compose" onSubmit={handleSend}>
          <div className="vendor-email-compose__to">
            <strong>To</strong>
            <span>
              {composeContact.name} &lt;{composeContact.email}&gt;
            </span>
          </div>
          <input
            name="subject"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={500}
            required
            disabled={sending}
          />
          <textarea
            name="body"
            placeholder="Write your message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            maxLength={20000}
            required
            disabled={sending}
          />
          <div className="vendor-email-compose__actions">
            <button type="submit" disabled={sending || !configured}>
              {sending ? "Sending…" : "Send email"}
            </button>
            <button type="button" className="delete" onClick={closeCompose} disabled={sending}>
              Cancel
            </button>
          </div>
          <p className="muted vendor-email-compose__hint">
            Replies go to your signed-in email. Sent from{" "}
            {status?.fromEmail ?? "your configured SupplierSync sender"}.
          </p>
        </form>
      )}

      <div className="vendor-email-history">
        <h4 className="vendor-email-history__title">Email history</h4>
        {historyError && <p className="banner inline error">{historyError}</p>}
        {!historyError && history.length === 0 && (
          <p className="muted">No emails sent to this vendor yet.</p>
        )}
        {history.length > 0 && (
          <ul className="vendor-email-history__list">
            {history.map((row) => (
              <li key={row.id}>
                <div className="vendor-email-history__meta">
                  <strong>{row.subject}</strong>
                  <span className={`vendor-email-status vendor-email-status--${row.status}`}>
                    {row.status === "sent" ? "Sent" : "Failed"}
                  </span>
                </div>
                <p className="muted">
                  To {row.toName || row.toEmail} · {formatSentAt(row.sentAt)}
                </p>
                {row.status === "failed" && row.errorMessage && (
                  <p className="muted">{row.errorMessage}</p>
                )}
                {row.status === "sent" && (
                  <p className="vendor-email-history__body">{row.bodyText}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
