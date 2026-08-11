import { Link } from "react-router-dom";
import { FormEvent, useId, useState } from "react";
import { DocumentViewerModal } from "./DocumentViewerModal";
import { ContractRenewalLossBadge } from "./ContractRenewalLossBadge";
import { FileAttachmentLink } from "./FileAttachmentLink";
import type { RenewalItem } from "../types";
import { calculateRenewalItemLoss } from "../lib/renewalLossCalculator";
import { formatDaysUntil, vendorContractsUrl } from "../lib/renewals";
import { getStatusClass, hasDownloadableFile, money, prettyDate } from "../lib/utils";

export function RenewalRow({
  item,
  handled = false,
  canMarkHandled = false,
  medianContractValue = 0,
  onMarkHandled,
  onReopen,
}: {
  item: RenewalItem;
  handled?: boolean;
  canMarkHandled?: boolean;
  medianContractValue?: number;
  onMarkHandled?: (contractId: string, note: string) => Promise<void>;
  onReopen?: (contractId: string) => Promise<void>;
}) {
  const hasFile = Boolean(item.fileUrl && item.fileName && hasDownloadableFile(item.fileUrl));
  const renewalLoss = calculateRenewalItemLoss({ item, medianValue: medianContractValue });
  const [viewingFile, setViewingFile] = useState(false);
  const [showHandleForm, setShowHandleForm] = useState(false);
  const [handleNote, setHandleNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const handleNoteId = useId();

  async function submitHandled(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onMarkHandled) return;
    setSaving(true);
    setActionError("");
    try {
      await onMarkHandled(item.contractId, handleNote);
      setShowHandleForm(false);
      setHandleNote("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not mark renewal handled.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen() {
    if (!onReopen) return;
    setSaving(true);
    setActionError("");
    try {
      await onReopen(item.contractId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reopen renewal.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`renewal-row-wrap renewal-row-wrap--${handled ? "handled" : item.urgency}`}>
      <Link className={`renewal-row renewal-row--${handled ? "handled" : item.urgency}`} to={vendorContractsUrl(item.vendorId)}>
        <div className="renewal-row-main">
          <strong>{item.contractName}</strong>
          <p className="muted small">
            {item.vendorName} · {item.dateLabel}: {prettyDate(item.actionDate)}
          </p>
          {handled && item.renewalHandledAt && (
            <p className="muted small">
              Handled {prettyDate(item.renewalHandledAt.slice(0, 10))}
              {item.renewalHandledNote ? ` · ${item.renewalHandledNote}` : ""}
            </p>
          )}
        </div>
        <div className="renewal-row-meta">
          {!handled && renewalLoss && (
            <span
              className="renewal-row-loss"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <ContractRenewalLossBadge
              contract={{
                id: item.contractId,
                name: item.contractName,
                startDate: item.actionDate,
                endDate: item.renewalType === "fixed_term" ? item.actionDate : null,
                renewalDate: item.renewalType !== "fixed_term" ? item.actionDate : null,
                renewalType: item.renewalType,
                noticePeriodDays: null,
                termMonths: null,
                value: item.value,
                status: item.status,
                renewalHandledAt: item.renewalHandledAt,
              }}
              lineItem={renewalLoss}
              medianContractValue={medianContractValue}
                vendor={{ id: item.vendorId, name: item.vendorName }}
              />
            </span>
          )}
          {!handled && (
            <span className={`renewal-urgency renewal-urgency--${item.urgency}`}>
              {formatDaysUntil(item.daysUntilEnd, item.renewalType)}
            </span>
          )}
          {handled && <span className="badge active">Handled</span>}
          <span className="muted small">{money(item.value)}</span>
          <span className={getStatusClass(item.status)}>{item.status}</span>
        </div>
      </Link>
      {hasFile && item.fileUrl && item.fileName && (
        <div className="renewal-row-file" onClick={(event) => event.preventDefault()}>
          <FileAttachmentLink
            fileUrl={item.fileUrl}
            fileName={item.fileName}
            fileSize={item.fileSize}
            onPreview={() => setViewingFile(true)}
          />
        </div>
      )}
      {canMarkHandled && !handled && onMarkHandled && (
        <div className="renewal-row-actions" onClick={(event) => event.preventDefault()}>
          {!showHandleForm ? (
            <button
              type="button"
              className="secondary renewal-handle-button"
              disabled={saving}
              onClick={() => setShowHandleForm(true)}
            >
              Mark handled
            </button>
          ) : (
            <form className="renewal-handle-form" onSubmit={(event) => void submitHandled(event)}>
              <label className="field-block" htmlFor={handleNoteId}>
                <span className="label">Optional note</span>
                <input
                  id={handleNoteId}
                  value={handleNote}
                  onChange={(event) => setHandleNote(event.target.value)}
                  placeholder="e.g. Renewed for 12 months"
                />
              </label>
              <div className="renewal-handle-form__actions">
                <button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Renewal taken care of"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={saving}
                  onClick={() => {
                    setShowHandleForm(false);
                    setHandleNote("");
                    setActionError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {canMarkHandled && handled && onReopen && (
        <div className="renewal-row-actions" onClick={(event) => event.preventDefault()}>
          <button type="button" className="secondary renewal-handle-button" disabled={saving} onClick={() => void handleReopen()}>
            {saving ? "Saving…" : "Reopen"}
          </button>
        </div>
      )}
      {actionError && (
        <p className="form-error renewal-row-error" role="alert">
          {actionError}
        </p>
      )}
      {viewingFile && item.fileUrl && item.fileName && (
        <DocumentViewerModal
          fileUrl={item.fileUrl}
          fileName={item.fileName}
          fileSize={item.fileSize}
          onClose={() => setViewingFile(false)}
        />
      )}
    </div>
  );
}

export function RenewalsEmptyState({ handled = false }: { handled?: boolean }) {
  if (handled) {
    return (
      <div className="renewals-empty card">
        <h3>No handled renewals yet</h3>
        <p className="muted small">
          When you mark a renewal as handled, it moves here so your open list stays focused on what still needs
          action.
        </p>
      </div>
    );
  }

  return (
    <div className="renewals-empty card">
      <h3>No renewals on the horizon</h3>
      <p className="muted small">
        Contracts with renewal or review dates in the next 90 days (or overdue in the last 30) appear here.
        Set renewal type and review dates on each vendor&apos;s <strong>Contracts</strong> tab — no need for
        placeholder end dates on auto-renewing agreements.
      </p>
    </div>
  );
}
