import type { Contract, ContractRenewalType, RenewalUrgency } from "../types";

/** Show contracts ending within this many days (and recently expired). */
export const RENEWAL_LOOKAHEAD_DAYS = 90;
export const RENEWAL_RECENT_EXPIRED_DAYS = 30;

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

/** The date that drives renewals list, urgency, and email reminders. */
export function getContractActionDate(contract: Pick<
  Contract,
  "renewalType" | "endDate" | "renewalDate" | "noticePeriodDays"
>): string | null {
  if (contract.renewalDate) return contract.renewalDate;
  if (contract.renewalType === "auto_renew" && contract.endDate && contract.noticePeriodDays) {
    return subtractDaysFromIsoDate(contract.endDate, contract.noticePeriodDays);
  }
  return contract.endDate;
}

export function getContractDateLabel(renewalType: ContractRenewalType): string {
  if (renewalType === "fixed_term") return CONTRACT_END_LABEL;
  return CONTRACT_REVIEW_LABEL;
}

export function daysUntilEnd(endDate: string) {
  const end = new Date(`${endDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function getRenewalUrgency(daysUntil: number): RenewalUrgency {
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 30) return "soon";
  return "upcoming";
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
