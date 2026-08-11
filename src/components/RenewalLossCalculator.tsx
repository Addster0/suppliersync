import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AUTO_RENEW_MISSED_BONUS_RATE,
  calculateRenewalLoss,
  DEFAULT_RENEGOTIATION_SAVINGS_RATE,
  RENEWAL_LOSS_REASON_LABELS,
} from "../lib/renewalLossCalculator";
import { vendorContractsUrl } from "../lib/renewals";
import { money } from "../lib/utils";
import type { RenewalItem, Vendor } from "../types";

type RenewalLossCalculatorProps = {
  vendors: Vendor[];
  renewals: RenewalItem[];
  disabled?: boolean;
  compact?: boolean;
};

export function RenewalLossCalculator({
  vendors,
  renewals,
  disabled = false,
  compact = false,
}: RenewalLossCalculatorProps) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(
    () => calculateRenewalLoss({ vendors, renewals, savingsRate: DEFAULT_RENEGOTIATION_SAVINGS_RATE }),
    [vendors, renewals],
  );

  const hasLoss = summary.totalEstimatedAnnualLoss > 0;

  return (
    <>
      <button
        className={
          compact
            ? "renewal-loss-trigger renewal-loss-trigger--compact"
            : "renewal-loss-trigger"
        }
        disabled={disabled}
        onClick={() => setOpen(true)}
        type="button"
      >
        {hasLoss ? (
          <>
            <span className="renewal-loss-trigger-label">Estimated yearly loss</span>
            <strong>{money(summary.totalEstimatedAnnualLoss)}/yr</strong>
          </>
        ) : (
          <span>Check renewal savings</span>
        )}
      </button>

      {open && (
        <div className="outreach-modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="outreach-modal outreach-modal--wide card renewal-loss-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-labelledby="renewal-loss-title"
            aria-modal="true"
          >
            <div className="outreach-modal-head">
              <div>
                <p className="eyebrow">Renewal savings calculator</p>
                <h3 id="renewal-loss-title">
                  {hasLoss
                    ? `You may be leaving ${money(summary.totalEstimatedAnnualLoss)} on the table each year`
                    : "You're caught up on contract renewals"}
                </h3>
                <p className="muted small">
                  Estimates how much you could save by renegotiating or restating out-of-date vendor contracts
                  before they roll forward on old terms.
                </p>
              </div>
              <button className="secondary" onClick={() => setOpen(false)} type="button">
                Close
              </button>
            </div>

            {hasLoss ? (
              <>
                <div className="renewal-loss-hero">
                  <div className="renewal-loss-stat renewal-loss-stat--primary">
                    <span className="renewal-loss-stat-label">Estimated yearly loss</span>
                    <strong>{money(summary.totalEstimatedAnnualLoss)}</strong>
                    <p className="muted small">
                      Based on {summary.atRiskContractCount} at-risk contract
                      {summary.atRiskContractCount === 1 ? "" : "s"} × ~{summary.savingsRatePercent}% typical
                      renegotiation savings
                      {summary.contractsMissingValueCount > 0
                        ? ` (${summary.contractsMissingValueCount} using estimated contract value)`
                        : ""}
                      .
                    </p>
                  </div>
                  <div className="renewal-loss-stat">
                    <span className="renewal-loss-stat-label">At-risk contracts</span>
                    <strong>{summary.atRiskContractCount}</strong>
                  </div>
                  <div className="renewal-loss-stat">
                    <span className="renewal-loss-stat-label">Assumed savings rate</span>
                    <strong>{summary.savingsRatePercent}%</strong>
                    <p className="muted small">
                      +{(AUTO_RENEW_MISSED_BONUS_RATE * 100).toFixed(0)}% when auto-renew notice was missed
                    </p>
                  </div>
                </div>

                <p className="label renewal-loss-breakdown-label">Breakdown</p>
                <ul className="renewal-loss-list">
                  {summary.lineItems.map((item) => (
                    <li className="renewal-loss-item" key={item.contractId}>
                      <div className="renewal-loss-item-main">
                        <div className="renewal-loss-item-head">
                          <strong>{item.contractName}</strong>
                          <span className="renewal-loss-item-amount">{money(item.estimatedAnnualLoss)}/yr</span>
                        </div>
                        <p className="muted small">
                          {item.vendorName} · {RENEWAL_LOSS_REASON_LABELS[item.reason]}
                          {item.valueIsEstimated ? " · estimated value" : ""}
                        </p>
                        <p className="muted small">{item.detail}</p>
                        <p className="muted small renewal-loss-item-math">
                          {money(item.annualValue)} contract value × {(item.savingsRate * 100).toFixed(0)}% savings
                        </p>
                      </div>
                      <Link className="attention-item-action" to={vendorContractsUrl(item.vendorId)}>
                        Review
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="renewal-loss-empty card">
                <strong>No out-of-date contracts detected</strong>
                <p className="muted small">
                  Keep contract end dates, review dates, and annual values current so renewals stay visible before
                  auto-renew windows close.
                </p>
              </div>
            )}

            <p className="muted small renewal-loss-disclaimer">
              Illustrative estimate only — actual savings depend on category, spend, and negotiation. Not financial
              or legal advice.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
