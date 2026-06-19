import { Link } from "react-router-dom";
import { buildAttentionItems, workspaceSpendSummary } from "../lib/attention";
import { topVendorsBySpend } from "../lib/spend";
import { money } from "../lib/utils";
import type { RenewalItem, Vendor } from "../types";
import { useSetupOptional } from "../contexts/SetupContext";

export function NeedsAttentionPanel({
  id,
  vendors,
  renewals,
  loading,
}: {
  id?: string;
  vendors: Vendor[];
  renewals: RenewalItem[];
  loading: boolean;
}) {
  const setup = useSetupOptional();

  if (loading) {
    return (
      <section id={id} className="attention-panel card">
        <p className="muted small">Loading…</p>
      </section>
    );
  }

  const attentionItems = buildAttentionItems(vendors, renewals);
  const spendSummary = workspaceSpendSummary(vendors);
  const topSpend = topVendorsBySpend(vendors, 5);
  const criticalCount = attentionItems.filter((item) => item.severity === "critical").length;
  const warningCount = attentionItems.filter((item) => item.severity === "warning").length;

  return (
    <section id={id} className="attention-panel">
      <div className="attention-panel-header">
        <div>
          <p className="eyebrow">Action items</p>
          <h3>Needs attention</h3>
          <p className="muted small">
            {vendors.length} vendor{vendors.length === 1 ? "" : "s"}
            {criticalCount + warningCount > 0
              ? ` · ${criticalCount + warningCount} item${criticalCount + warningCount === 1 ? "" : "s"} need action`
              : " · you're caught up on renewals and compliance"}
          </p>
        </div>
        <div className="attention-stats">
          <div className="attention-stat">
            <span className="attention-stat-label">YTD spend logged</span>
            <strong>{money(spendSummary.ytd)}</strong>
          </div>
          <div className="attention-stat">
            <span className="attention-stat-label">Tracked vendors</span>
            <strong>
              {spendSummary.trackedVendors}/{spendSummary.vendorCount}
            </strong>
          </div>
        </div>
      </div>

      {setup && !setup.isComplete && !setup.loading && (
        <div className="attention-setup-banner card">
          <div>
            <p className="label">Finish workspace setup</p>
            <p className="muted small">
              {setup.completedCount} of {setup.totalSteps} steps complete — add a renewal date to unlock the full
              renewals dashboard.
            </p>
          </div>
          <button className="secondary" onClick={setup.openSetup} type="button">
            Resume setup
          </button>
        </div>
      )}

      {attentionItems.length > 0 ? (
        <ul className="attention-list">
          {attentionItems.slice(0, 8).map((item) => (
            <li key={item.id} className={`attention-item attention-item--${item.severity}`}>
              <div className="attention-item-body">
                <strong>{item.title}</strong>
                <p className="muted small">{item.detail}</p>
              </div>
              {item.href && (
                <Link className="attention-item-action" to={item.href}>
                  {item.actionLabel ?? "Open"}
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="attention-empty card">
          <strong>All clear for now</strong>
          <p className="muted small">
            No overdue renewals or missing compliance items. Keep contract end dates and COI/W-9 uploads current.
          </p>
        </div>
      )}

      {topSpend.length > 0 && (
        <div className="attention-spend card">
          <p className="label">Top vendors by YTD spend</p>
          <ul className="attention-spend-list">
            {topSpend.map(({ vendor, total }) => (
              <li key={vendor.id}>
                <Link to={`/app?vendor=${vendor.id}&tab=spend`}>
                  <span>{vendor.name}</span>
                  <strong>{money(total)}</strong>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
