import type { RenewalUrgency } from "../types";

/** Show contracts ending within this many days (and recently expired). */
export const RENEWAL_LOOKAHEAD_DAYS = 90;
export const RENEWAL_RECENT_EXPIRED_DAYS = 30;

export function formatDateForQuery(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export function formatDaysUntil(daysUntil: number) {
  if (daysUntil < 0) {
    const days = Math.abs(daysUntil);
    return days === 1 ? "Expired yesterday" : `Expired ${days} days ago`;
  }
  if (daysUntil === 0) return "Ends today";
  if (daysUntil === 1) return "Ends tomorrow";
  return `Ends in ${daysUntil} days`;
}

export function urgencyLabel(urgency: RenewalUrgency) {
  if (urgency === "overdue") return "Overdue";
  if (urgency === "soon") return "Due within 30 days";
  return "Due within 90 days";
}

export function vendorContractsUrl(vendorId: string) {
  return `/app?vendor=${vendorId}&tab=contracts`;
}
