import { useState } from "react";
import {
  calculateContractRenewalLoss,
  RENEWAL_LOSS_REASON_LABELS,
  type RenewalLossLineItem,
} from "../lib/renewalLossCalculator";
import { money } from "../lib/utils";
import type { Contract, Vendor } from "../types";

type ContractRenewalLossBadgeProps = {
  contract: Contract;
  vendor: Pick<Vendor, "id" | "name">;
  medianContractValue: number;
  /** When set, show this precomputed line item instead of recalculating. */
  lineItem?: RenewalLossLineItem | null;
};

export function ContractRenewalLossBadge({
  contract,
  vendor,
  medianContractValue,
  lineItem,
}: ContractRenewalLossBadgeProps) {
  const [open, setOpen] = useState(false);
  const loss =
    lineItem ??
    calculateContractRenewalLoss({
      contract,
      vendorId: vendor.id,
      vendorName: vendor.name,
      medianValue: medianContractValue,
    });

  if (!loss) return null;

  return (
    <>
      <button
        className="contract-loss-badge"
        onClick={() => setOpen(true)}
        title={loss.detail}
        type="button"
      >
        <span className="contract-loss-badge__label">Est. yearly loss</span>
        <strong>{money(loss.estimatedAnnualLoss)}/yr</strong>
      </button>

      {open && (
        <div className="outreach-modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="outreach-modal card contract-loss-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-labelledby={`contract-loss-${contract.id}`}
            aria-modal="true"
          >
            <div className="outreach-modal-head">
              <div>
                <p className="eyebrow">Renewal savings</p>
                <h3 id={`contract-loss-${contract.id}`}>{contract.name}</h3>
                <p className="muted small">{vendor.name}</p>
              </div>
              <button className="secondary" onClick={() => setOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="contract-loss-modal-stat">
              <span className="contract-loss-modal-stat__label">Estimated yearly loss</span>
              <strong>{money(loss.estimatedAnnualLoss)}</strong>
              <p className="muted small">
                {RENEWAL_LOSS_REASON_LABELS[loss.reason]}
                {loss.valueIsEstimated ? " · estimated contract value" : ""}
              </p>
            </div>

            <p className="muted small">{loss.detail}</p>
            <p className="muted small contract-loss-modal-math">
              {money(loss.annualValue)} contract value × {(loss.savingsRate * 100).toFixed(0)}% typical
              renegotiation savings
            </p>
            <p className="muted small renewal-loss-disclaimer">
              Illustrative estimate only — not financial or legal advice.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
