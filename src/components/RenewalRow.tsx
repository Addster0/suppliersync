import { Link } from "react-router-dom";
import { FileAttachmentLink } from "./FileAttachmentLink";
import type { RenewalItem } from "../types";
import { formatDaysUntil, vendorContractsUrl } from "../lib/renewals";
import { getStatusClass, hasDownloadableFile, money, prettyDate } from "../lib/utils";

export function RenewalRow({ item }: { item: RenewalItem }) {
  const hasFile = Boolean(item.fileUrl && item.fileName && hasDownloadableFile(item.fileUrl));

  return (
    <div className={`renewal-row-wrap renewal-row-wrap--${item.urgency}`}>
      <Link className={`renewal-row renewal-row--${item.urgency}`} to={vendorContractsUrl(item.vendorId)}>
        <div className="renewal-row-main">
          <strong>{item.contractName}</strong>
          <p className="muted small">
            {item.vendorName} · ends {prettyDate(item.endDate)}
          </p>
        </div>
        <div className="renewal-row-meta">
          <span className={`renewal-urgency renewal-urgency--${item.urgency}`}>
            {formatDaysUntil(item.daysUntilEnd)}
          </span>
          <span className="muted small">{money(item.value)}</span>
          <span className={getStatusClass(item.status)}>{item.status}</span>
        </div>
      </Link>
      {hasFile && item.fileUrl && item.fileName && (
        <div className="renewal-row-file">
          <FileAttachmentLink
            fileUrl={item.fileUrl}
            fileName={item.fileName}
            fileSize={item.fileSize}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export function RenewalsEmptyState() {
  return (
    <div className="renewals-empty card">
      <h3>No renewals on the horizon</h3>
      <p className="muted small">
        Contracts with end dates in the next 90 days (or expired in the last 30) will show up here. Add end dates on
        each vendor&apos;s <strong>Contracts</strong> tab.
      </p>
    </div>
  );
}
