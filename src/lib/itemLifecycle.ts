import { getContractActionDate, resolveContractEndDate } from "./renewals";
import type { Contract, DocumentItem } from "../types";

/** Items uploaded/created within this window count as "new" until viewed. */
export const NEW_ITEM_DAYS = 30;

export type ItemLifecycle = "new" | "active" | "expired";
export type ItemLifecycleFilter = "all" | ItemLifecycle;

export function formatDateForCompare(isoDate: string): string {
  return isoDate.slice(0, 10);
}

export function isPastDate(isoDate: string | null | undefined): boolean {
  if (!isoDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${formatDateForCompare(isoDate)}T00:00:00`);
  return target < today;
}

export function isWithinNewWindow(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const created = new Date(`${formatDateForCompare(createdAt)}T00:00:00`);
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - NEW_ITEM_DAYS);
  return created >= cutoff;
}

function viewedStorageKey(organizationId: string, kind: "documents" | "contracts") {
  return `viewed-${kind}-${organizationId}`;
}

export function loadViewedIds(organizationId: string, kind: "documents" | "contracts"): Set<string> {
  try {
    const raw = localStorage.getItem(viewedStorageKey(organizationId, kind));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function markViewed(organizationId: string, kind: "documents" | "contracts", id: string) {
  const viewed = loadViewedIds(organizationId, kind);
  if (viewed.has(id)) return;
  viewed.add(id);
  localStorage.setItem(viewedStorageKey(organizationId, kind), JSON.stringify([...viewed]));
}

export function classifyDocument(
  document: Pick<DocumentItem, "id" | "createdAt" | "expiresAt">,
  viewedIds: Set<string>
): ItemLifecycle {
  if (isPastDate(document.expiresAt)) return "expired";
  if (isWithinNewWindow(document.createdAt) && !viewedIds.has(document.id)) return "new";
  return "active";
}

export function classifyContract(
  contract: Pick<
    Contract,
    "id" | "createdAt" | "endDate" | "renewalDate" | "renewalType" | "noticePeriodDays" | "status"
  >,
  viewedIds: Set<string>
): ItemLifecycle {
  if (contract.status === "expired") return "expired";
  if (contract.renewalType === "fixed_term" && isPastDate(resolveContractEndDate(contract))) {
    return "expired";
  }

  const actionDate = getContractActionDate(contract);
  if (
    contract.renewalType !== "fixed_term" &&
    contract.renewalType !== "evergreen" &&
    isPastDate(actionDate)
  ) {
    return "expired";
  }

  // Past term end always counts as expired, even if a future review date was stored.
  if (isPastDate(resolveContractEndDate(contract))) return "expired";

  if (isWithinNewWindow(contract.createdAt) && !viewedIds.has(contract.id)) return "new";
  return "active";
}

export function matchesLifecycleFilter(lifecycle: ItemLifecycle, filter: ItemLifecycleFilter): boolean {
  return filter === "all" || lifecycle === filter;
}

export function lifecycleBadgeLabel(lifecycle: ItemLifecycle): string | null {
  if (lifecycle === "new") return "New";
  if (lifecycle === "expired") return "Expired";
  return null;
}

export function lifecycleSortDate(
  kind: "document" | "contract",
  item: DocumentItem | Contract
): string {
  if (kind === "document") {
    const doc = item as DocumentItem;
    return doc.expiresAt ?? doc.createdAt;
  }
  const contract = item as Contract;
  return (
    getContractActionDate(contract) ??
    contract.endDate ??
    contract.createdAt ??
    contract.startDate
  );
}
