import { daysUntilEnd, getContractActionDate, getRenewalUrgency } from "./renewals";
import type { Contract, ContractRenewalType, RenewalItem, Vendor } from "../types";

/** Typical savings when renegotiating vendor contracts before renewal (healthcare benchmarks ~10–15%). */
export const DEFAULT_RENEGOTIATION_SAVINGS_RATE = 0.12;

/** Extra uplift when an auto-renew notice window was missed. */
export const AUTO_RENEW_MISSED_BONUS_RATE = 0.03;

export type RenewalLossReason =
  | "overdue"
  | "due_soon"
  | "expired"
  | "auto_renew_missed"
  | "untracked";

export type RenewalLossLineItem = {
  contractId: string;
  contractName: string;
  vendorId: string;
  vendorName: string;
  annualValue: number;
  valueIsEstimated: boolean;
  estimatedAnnualLoss: number;
  savingsRate: number;
  reason: RenewalLossReason;
  renewalType: ContractRenewalType;
  detail: string;
};

export type RenewalLossSummary = {
  totalEstimatedAnnualLoss: number;
  atRiskContractCount: number;
  contractsMissingValueCount: number;
  savingsRatePercent: number;
  lineItems: RenewalLossLineItem[];
};

export const RENEWAL_LOSS_REASON_LABELS: Record<RenewalLossReason, string> = {
  overdue: "Review overdue",
  due_soon: "Due within 30 days",
  expired: "Contract expired",
  auto_renew_missed: "Missed auto-renew notice",
  untracked: "No renewal date on file",
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function savingsRateForContract(reason: RenewalLossReason, renewalType: ContractRenewalType, baseRate: number) {
  if (renewalType === "auto_renew" && (reason === "overdue" || reason === "auto_renew_missed")) {
    return baseRate + AUTO_RENEW_MISSED_BONUS_RATE;
  }
  return baseRate;
}

function reasonDetail(reason: RenewalLossReason, renewalType: ContractRenewalType, actionDate: string | null) {
  switch (reason) {
    case "overdue":
      return actionDate
        ? `Review date passed — renegotiate before terms roll forward (${actionDate}).`
        : "Review date passed — likely paying prior-term rates.";
    case "due_soon":
      return "Renewal or review window closing — negotiate now to avoid auto-renew at old rates.";
    case "expired":
      return "Agreement expired — restate or replace to avoid gaps and overpaying.";
    case "auto_renew_missed":
      return "Auto-renew notice window missed — harder to exit or improve terms this cycle.";
    case "untracked":
      return renewalType === "evergreen"
        ? "Evergreen contract with no review date — easy to forget annual savings."
        : "Active contract without a tracked renewal date.";
    default:
      return "";
  }
}

export function getMedianContractValue(vendors: Vendor[]): number {
  const valuedContracts = vendors.flatMap((vendor) =>
    vendor.contracts.filter((contract) => contract.value > 0).map((contract) => contract.value),
  );
  return median(valuedContracts);
}

export function calculateContractRenewalLoss(params: {
  contract: Contract;
  vendorId: string;
  vendorName: string;
  medianValue: number;
  savingsRate?: number;
}): RenewalLossLineItem | null {
  return classifyContract({
    contract: params.contract,
    vendorId: params.vendorId,
    vendorName: params.vendorName,
    medianValue: params.medianValue,
    baseRate: params.savingsRate ?? DEFAULT_RENEGOTIATION_SAVINGS_RATE,
  });
}

export function calculateRenewalItemLoss(params: {
  item: RenewalItem;
  medianValue: number;
  savingsRate?: number;
}): RenewalLossLineItem | null {
  const { item, medianValue } = params;
  const baseRate = params.savingsRate ?? DEFAULT_RENEGOTIATION_SAVINGS_RATE;

  if (item.renewalHandledAt) return null;
  if (item.status === "inactive" || item.status === "pending") return null;

  let reason: RenewalLossReason | null = null;
  if (item.status === "expired") {
    reason = "expired";
  } else if (item.urgency === "overdue") {
    reason = item.renewalType === "auto_renew" ? "auto_renew_missed" : "overdue";
  } else if (item.urgency === "soon") {
    reason = "due_soon";
  }

  if (!reason) return null;

  const valueIsEstimated = item.value <= 0;
  const annualValue = valueIsEstimated ? medianValue : item.value;
  if (annualValue <= 0) return null;

  const savingsRate = savingsRateForContract(reason, item.renewalType, baseRate);

  return {
    contractId: item.contractId,
    contractName: item.contractName,
    vendorId: item.vendorId,
    vendorName: item.vendorName,
    annualValue,
    valueIsEstimated,
    estimatedAnnualLoss: Math.round(annualValue * savingsRate),
    savingsRate,
    reason,
    renewalType: item.renewalType,
    detail: reasonDetail(reason, item.renewalType, item.actionDate),
  };
}

function classifyContract(params: {
  contract: Contract;
  vendorId: string;
  vendorName: string;
  medianValue: number;
  baseRate: number;
}): RenewalLossLineItem | null {
  const { contract, vendorId, vendorName, medianValue, baseRate } = params;

  if (contract.renewalHandledAt) return null;
  if (contract.status === "inactive" || contract.status === "pending") return null;

  let reason: RenewalLossReason | null = null;
  const actionDate = getContractActionDate(contract);

  if (contract.status === "expired") {
    reason = "expired";
  } else if (!actionDate) {
    if (contract.status === "active") reason = "untracked";
  } else {
    const days = daysUntilEnd(actionDate);
    const urgency = getRenewalUrgency(days);
    if (urgency === "overdue") {
      reason =
        contract.renewalType === "auto_renew" && contract.noticePeriodDays
          ? "auto_renew_missed"
          : "overdue";
    } else if (urgency === "soon") {
      reason = "due_soon";
    }
  }

  if (!reason) return null;

  const valueIsEstimated = contract.value <= 0;
  const annualValue = valueIsEstimated ? medianValue : contract.value;
  if (annualValue <= 0) return null;

  const savingsRate = savingsRateForContract(reason, contract.renewalType, baseRate);

  return {
    contractId: contract.id,
    contractName: contract.name,
    vendorId,
    vendorName,
    annualValue,
    valueIsEstimated,
    estimatedAnnualLoss: Math.round(annualValue * savingsRate),
    savingsRate,
    reason,
    renewalType: contract.renewalType,
    detail: reasonDetail(reason, contract.renewalType, actionDate),
  };
}

function mergeRenewalItems(
  lineItems: Map<string, RenewalLossLineItem>,
  renewals: RenewalItem[],
  baseRate: number,
) {
  for (const renewal of renewals) {
    if (renewal.renewalHandledAt) continue;
    if (renewal.urgency !== "overdue" && renewal.urgency !== "soon") continue;

    const reason: RenewalLossReason =
      renewal.urgency === "overdue"
        ? renewal.renewalType === "auto_renew"
          ? "auto_renew_missed"
          : "overdue"
        : "due_soon";

    if (renewal.value <= 0) continue;

    const savingsRate = savingsRateForContract(reason, renewal.renewalType, baseRate);
    lineItems.set(renewal.contractId, {
      contractId: renewal.contractId,
      contractName: renewal.contractName,
      vendorId: renewal.vendorId,
      vendorName: renewal.vendorName,
      annualValue: renewal.value,
      valueIsEstimated: false,
      estimatedAnnualLoss: Math.round(renewal.value * savingsRate),
      savingsRate,
      reason,
      renewalType: renewal.renewalType,
      detail: reasonDetail(reason, renewal.renewalType, renewal.actionDate),
    });
  }
}

export function calculateRenewalLoss(params: {
  vendors: Vendor[];
  renewals?: RenewalItem[];
  savingsRate?: number;
}): RenewalLossSummary {
  const baseRate = params.savingsRate ?? DEFAULT_RENEGOTIATION_SAVINGS_RATE;
  const medianValue = getMedianContractValue(params.vendors);

  const lineItems = new Map<string, RenewalLossLineItem>();

  for (const vendor of params.vendors) {
    if (vendor.status !== "active") continue;
    for (const contract of vendor.contracts) {
      const item = classifyContract({
        contract,
        vendorId: vendor.id,
        vendorName: vendor.name,
        medianValue,
        baseRate,
      });
      if (item) lineItems.set(item.contractId, item);
    }
  }

  if (params.renewals?.length) {
    mergeRenewalItems(lineItems, params.renewals, baseRate);
  }

  const sortedItems = [...lineItems.values()].sort(
    (a, b) => b.estimatedAnnualLoss - a.estimatedAnnualLoss || a.contractName.localeCompare(b.contractName),
  );

  return {
    totalEstimatedAnnualLoss: sortedItems.reduce((sum, item) => sum + item.estimatedAnnualLoss, 0),
    atRiskContractCount: sortedItems.length,
    contractsMissingValueCount: sortedItems.filter((item) => item.valueIsEstimated).length,
    savingsRatePercent: Math.round(baseRate * 100),
    lineItems: sortedItems,
  };
}
