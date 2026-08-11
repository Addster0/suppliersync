import type { Contract, ContractRenewalType, RenewalItem, RenewalUrgency, Vendor } from "../types";

/** Show upcoming contracts ending within this many days. */
export const RENEWAL_LOOKAHEAD_DAYS = 90;
/**
 * Kept for email digests / copy that reference a "recently expired" window.
 * Open renewals keep *all* unhandled overdue contracts visible until marked handled —
 * backfilled expired contracts must not fall off the radar after 30 days.
 */
export const RENEWAL_RECENT_EXPIRED_DAYS = 30;

/** Whether an unhandled contract belongs on the open renewals list. */
export function isInOpenRenewalsWindow(daysUntil: number): boolean {
  if (daysUntil < 0) return true;
  return daysUntil <= RENEWAL_LOOKAHEAD_DAYS;
}

/** User-facing labels for contract term dates (maps to start_date / end_date). */
export const CONTRACT_START_LABEL = "Contract start";
export const CONTRACT_END_LABEL = "Contract end (renewal date)";
export const CONTRACT_REVIEW_LABEL = "Review by";
export const CONTRACT_START_HINT = "When the current agreement term began.";
export const CONTRACT_END_HINT = "When the fixed term ends — used for renewal reminders.";
export const CONTRACT_REVIEW_HINT =
  "When to review or give notice (e.g. 90 days before auto-renew). Used for renewal reminders.";

export const RENEWAL_TYPE_OPTIONS: {
  value: ContractRenewalType;
  label: string;
  hint: string;
}[] = [
  {
    value: "fixed_term",
    label: "Fixed term",
    hint: "Agreement ends on a specific date.",
  },
  {
    value: "auto_renew",
    label: "Auto-renews",
    hint: "Renews unless you give notice — set a review date or term end + notice period.",
  },
  {
    value: "month_to_month",
    label: "Month-to-month",
    hint: "Ongoing with periodic review — set when to check in next.",
  },
  {
    value: "evergreen",
    label: "Evergreen / ongoing",
    hint: "No fixed end — optional annual review reminder.",
  },
];

export function renewalTypeLabel(type: ContractRenewalType): string {
  return RENEWAL_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export function formatDateForQuery(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addMonthsToIsoDate(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return formatDateForQuery(date);
}

export function subtractDaysFromIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() - days);
  return formatDateForQuery(date);
}

/** Suggest a review date from start + term length minus notice period. */
export function computeSuggestedReviewDate(params: {
  startDate: string;
  termMonths: number;
  noticePeriodDays?: number | null;
}): string {
  const termEnd = addMonthsToIsoDate(params.startDate, params.termMonths);
  if (params.noticePeriodDays && params.noticePeriodDays > 0) {
    return subtractDaysFromIsoDate(termEnd, params.noticePeriodDays);
  }
  return termEnd;
}

/** Normalize DB/extract timestamps to YYYY-MM-DD for reliable day math. */
export function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

type ContractDateFields = Pick<
  Contract,
  "renewalType" | "endDate" | "renewalDate" | "noticePeriodDays"
> &
  Partial<Pick<Contract, "startDate" | "termMonths" | "status">>;

/** Term end date, including start + term length when end_date was left blank. */
export function resolveContractEndDate(contract: Partial<Pick<Contract, "endDate" | "startDate" | "termMonths">>): string | null {
  const endDate = normalizeIsoDate(contract.endDate ?? null);
  if (endDate) return endDate;
  const startDate = normalizeIsoDate(contract.startDate ?? null);
  if (startDate && contract.termMonths && contract.termMonths > 0) {
    return addMonthsToIsoDate(startDate, contract.termMonths);
  }
  return null;
}

/**
 * The date that drives renewals list, urgency, and email reminders.
 * Fixed-term contracts use term end — never a leftover review date from PDF extract/import.
 */
export function getContractActionDate(contract: ContractDateFields): string | null {
  const renewalDate = normalizeIsoDate(contract.renewalDate);
  const endDate = resolveContractEndDate(contract);

  if (contract.renewalType === "fixed_term") {
    return endDate ?? renewalDate;
  }

  if (renewalDate) return renewalDate;
  if (contract.renewalType === "auto_renew" && endDate && contract.noticePeriodDays) {
    return subtractDaysFromIsoDate(endDate, contract.noticePeriodDays);
  }
  return endDate;
}

/**
 * Urgency date for open renewals / needs-attention / savings.
 * Uses the earlier of action date and term end so a future "review by" cannot hide a 2022 expiry.
 */
export function getContractUrgencyDate(contract: ContractDateFields): string | null {
  const actionDate = getContractActionDate(contract);
  const endDate = resolveContractEndDate(contract);
  if (actionDate && endDate) return actionDate <= endDate ? actionDate : endDate;
  return actionDate ?? endDate;
}

export function getContractDateLabel(renewalType: ContractRenewalType): string {
  if (renewalType === "fixed_term") return CONTRACT_END_LABEL;
  return CONTRACT_REVIEW_LABEL;
}

export function daysUntilEnd(endDate: string) {
  const normalized = normalizeIsoDate(endDate) ?? endDate.slice(0, 10);
  const end = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(end.getTime())) return Number.NaN;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** True when an unhandled contract should appear as overdue (status or past urgency date). */
export function isContractOverdue(contract: ContractDateFields & Partial<Pick<Contract, "renewalHandledAt">>): boolean {
  if (contract.renewalHandledAt) return false;
  if (contract.status === "inactive") return false;
  if (contract.status === "expired") return true;
  const urgencyDate = getContractUrgencyDate(contract);
  if (!urgencyDate) return false;
  const days = daysUntilEnd(urgencyDate);
  return Number.isFinite(days) && days < 0;
}

export function getRenewalUrgency(daysUntil: number): RenewalUrgency {
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 30) return "soon";
  return "upcoming";
}

/**
 * Build a RenewalItem from the same vendor+contract objects the Contracts tab uses.
 * This is the source of truth for the open Renewals list so Expired contracts cannot
 * disappear behind a separate API/join filter.
 */
export function contractToRenewalItem(
  contract: Contract,
  vendor: Pick<Vendor, "id" | "name">,
): RenewalItem | null {
  if (contract.status === "inactive") return null;

  const overdue = isContractOverdue(contract);
  const urgencyDate = getContractUrgencyDate(contract);
  let effectiveDate =
    urgencyDate ??
    normalizeIsoDate(contract.endDate) ??
    normalizeIsoDate(contract.renewalDate) ??
    normalizeIsoDate(contract.startDate) ??
    null;

  // Status-expired / overdue rows with no parseable dates still belong on the open list.
  if (!effectiveDate) {
    if (!overdue && contract.status !== "expired") return null;
    effectiveDate = "1970-01-01";
  }

  const days = daysUntilEnd(effectiveDate);
  const daysForWindow = Number.isFinite(days) ? days : -9999;
  const urgency: RenewalUrgency =
    overdue || contract.status === "expired" || daysForWindow < 0
      ? "overdue"
      : getRenewalUrgency(daysForWindow);

  // Keep every unhandled overdue/expired contract, even if a future review date
  // would otherwise push daysUntil outside the 90-day lookahead.
  if (!overdue && contract.status !== "expired" && !isInOpenRenewalsWindow(daysForWindow)) {
    return null;
  }

  return {
    contractId: contract.id,
    contractName: contract.name,
    vendorId: vendor.id,
    vendorName: vendor.name,
    actionDate: effectiveDate,
    dateLabel: getContractDateLabel(contract.renewalType),
    renewalType: contract.renewalType,
    endDate: effectiveDate,
    value: Number.isFinite(Number(contract.value)) ? Number(contract.value) : 0,
    status: contract.status,
    daysUntilEnd: daysForWindow,
    urgency,
    renewalHandledAt: contract.renewalHandledAt ?? null,
    renewalHandledNote: contract.renewalHandledNote ?? null,
    fileUrl: contract.file?.fileUrl,
    fileName: contract.file?.fileName,
    fileSize: contract.file?.fileSize,
  };
}

/** Unhandled renewals derived from workspace vendors (aligns with Contracts "Expired" badges). */
export function buildOpenRenewalsFromVendors(vendors: Vendor[]): RenewalItem[] {
  const items: RenewalItem[] = [];
  for (const vendor of vendors) {
    if (vendor.status === "inactive") continue;
    for (const contract of vendor.contracts) {
      if (contract.renewalHandledAt) continue;
      const item = contractToRenewalItem(contract, vendor);
      if (item) items.push(item);
    }
  }
  return items.sort((a, b) => a.daysUntilEnd - b.daysUntilEnd || a.actionDate.localeCompare(b.actionDate));
}

export function formatDaysUntil(daysUntil: number, renewalType: ContractRenewalType = "fixed_term") {
  const verb = renewalType === "fixed_term" ? "Ends" : "Review";
  if (daysUntil < 0) {
    const days = Math.abs(daysUntil);
    return renewalType === "fixed_term"
      ? days === 1
        ? "Expired yesterday"
        : `Expired ${days} days ago`
      : days === 1
        ? "Review was yesterday"
        : `Review overdue by ${days} days`;
  }
  if (daysUntil === 0) return renewalType === "fixed_term" ? "Ends today" : "Review today";
  if (daysUntil === 1) return renewalType === "fixed_term" ? "Ends tomorrow" : "Review tomorrow";
  return renewalType === "fixed_term" ? `Ends in ${daysUntil} days` : `Review in ${daysUntil} days`;
}

export function urgencyLabel(urgency: RenewalUrgency) {
  if (urgency === "overdue") return "Overdue";
  if (urgency === "soon") return "Due within 30 days";
  return "Due within 90 days";
}

export function vendorContractsUrl(vendorId: string) {
  return `/app?vendor=${vendorId}&tab=contracts`;
}

export function validateContractDates(contract: Pick<
  Contract,
  "name" | "startDate" | "endDate" | "renewalDate" | "renewalType"
>): string | null {
  if (!contract.name.trim()) return "Contract name is required.";
  if (!contract.startDate) return "Start date is required.";

  switch (contract.renewalType) {
    case "fixed_term":
      if (!contract.endDate) return "End date is required for fixed-term contracts.";
      return null;
    case "auto_renew":
      if (!contract.endDate && !contract.renewalDate) {
        return "Set a review date or term end date (with notice period) for auto-renewing contracts.";
      }
      return null;
    case "month_to_month":
      if (!contract.renewalDate) return "Review date is required for month-to-month contracts.";
      return null;
    case "evergreen":
      return null;
    default:
      return null;
  }
}
