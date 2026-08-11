export const DEFAULT_RENEGOTIATION_SAVINGS_RATE = 0.12;
export const AUTO_RENEW_MISSED_BONUS_RATE = 0.03;

export type RenewalLossReason =
  | "overdue"
  | "due_soon"
  | "expired"
  | "auto_renew_missed"
  | "untracked";

export type ContractSnapshot = {
  id: string;
  name: string;
  vendorId: string;
  vendorName: string;
  vendorStatus: string;
  value: number;
  status: string;
  endDate: string | null;
  renewalDate: string | null;
  renewalType: string;
  noticePeriodDays: number | null;
  renewalHandledAt: string | null;
};

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
  renewalType: string;
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

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatDateForQuery(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function subtractDaysFromIsoDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() - days);
  return formatDateForQuery(date);
}

function normalizeIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function getContractActionDate(contract: Pick<
  ContractSnapshot,
  "renewalType" | "endDate" | "renewalDate" | "noticePeriodDays"
>) {
  const renewalDate = normalizeIsoDate(contract.renewalDate);
  const endDate = normalizeIsoDate(contract.endDate);

  if (contract.renewalType === "fixed_term") {
    return endDate ?? renewalDate;
  }
  if (renewalDate) return renewalDate;
  if (contract.renewalType === "auto_renew" && endDate && contract.noticePeriodDays) {
    return subtractDaysFromIsoDate(endDate, contract.noticePeriodDays);
  }
  return endDate;
}

function getContractUrgencyDate(contract: Pick<
  ContractSnapshot,
  "renewalType" | "endDate" | "renewalDate" | "noticePeriodDays" | "status"
>) {
  const actionDate = getContractActionDate(contract);
  const endDate = normalizeIsoDate(contract.endDate);
  if (actionDate && endDate) return actionDate <= endDate ? actionDate : endDate;
  return actionDate ?? endDate;
}

function daysUntilEnd(endDate: string) {
  const normalized = normalizeIsoDate(endDate) ?? endDate.slice(0, 10);
  const end = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(end.getTime())) return Number.NaN;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getRenewalUrgency(daysUntil: number): "overdue" | "soon" | "upcoming" {
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 30) return "soon";
  return "upcoming";
}

function savingsRateForContract(reason: RenewalLossReason, renewalType: string, baseRate: number) {
  if (renewalType === "auto_renew" && (reason === "overdue" || reason === "auto_renew_missed")) {
    return baseRate + AUTO_RENEW_MISSED_BONUS_RATE;
  }
  return baseRate;
}

function reasonDetail(reason: RenewalLossReason, renewalType: string, actionDate: string | null) {
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

function classifyContract(params: {
  contract: ContractSnapshot;
  medianValue: number;
  baseRate: number;
}): RenewalLossLineItem | null {
  const { contract, medianValue, baseRate } = params;

  if (contract.renewalHandledAt) return null;
  if (contract.vendorStatus === "inactive") return null;
  if (contract.status === "inactive") return null;

  let reason: RenewalLossReason | null = null;
  const actionDate = getContractUrgencyDate(contract);
  const overdue =
    contract.status === "expired" ||
    (actionDate != null && Number.isFinite(daysUntilEnd(actionDate)) && daysUntilEnd(actionDate) < 0);

  if (contract.status === "expired") {
    reason = "expired";
  } else if (overdue) {
    reason =
      contract.renewalType === "auto_renew" && contract.noticePeriodDays
        ? "auto_renew_missed"
        : actionDate && daysUntilEnd(actionDate) < 0 && contract.renewalType === "fixed_term"
          ? "expired"
          : "overdue";
  } else if (!actionDate) {
    if (contract.status === "active") reason = "untracked";
  } else {
    const days = daysUntilEnd(actionDate);
    if (Number.isFinite(days)) {
      const urgency = getRenewalUrgency(days);
      if (urgency === "soon") {
        reason = "due_soon";
      }
    }
  }

  if (!reason) return null;

  const direct = typeof contract.value === "number" && Number.isFinite(contract.value) ? contract.value : Number(contract.value);
  const valueIsEstimated = !(Number.isFinite(direct) && direct > 0);
  const annualValue = valueIsEstimated ? medianValue : direct;
  // Keep out-of-date contracts even when value is unknown so digests don't claim "none detected".
  const safeAnnual = Number.isFinite(annualValue) && annualValue > 0 ? annualValue : 0;
  const savingsRate = savingsRateForContract(reason, contract.renewalType, baseRate);

  return {
    contractId: contract.id,
    contractName: contract.name,
    vendorId: contract.vendorId,
    vendorName: contract.vendorName,
    annualValue: safeAnnual,
    valueIsEstimated,
    estimatedAnnualLoss: Math.round(safeAnnual * savingsRate),
    savingsRate,
    reason,
    renewalType: contract.renewalType,
    detail: reasonDetail(reason, contract.renewalType, actionDate),
  };
}

export function calculateRenewalLossFromContracts(
  contracts: ContractSnapshot[],
  savingsRate = DEFAULT_RENEGOTIATION_SAVINGS_RATE,
): RenewalLossSummary {
  const medianValue = median(contracts.filter((row) => row.value > 0).map((row) => row.value));
  const lineItems = contracts
    .map((contract) => classifyContract({ contract, medianValue, baseRate: savingsRate }))
    .filter((item): item is RenewalLossLineItem => item != null)
    .sort(
      (a, b) =>
        b.estimatedAnnualLoss - a.estimatedAnnualLoss || a.contractName.localeCompare(b.contractName),
    );

  return {
    totalEstimatedAnnualLoss: lineItems.reduce((sum, item) => sum + item.estimatedAnnualLoss, 0),
    atRiskContractCount: lineItems.length,
    contractsMissingValueCount: lineItems.filter((item) => item.valueIsEstimated).length,
    savingsRatePercent: Math.round(savingsRate * 100),
    lineItems,
  };
}
