import { daysUntilEnd } from "./renewals";
import type { Vendor } from "../types";

export type VendorSortKey =
  | "name-asc"
  | "name-desc"
  | "category-asc"
  | "category-desc"
  | "added-desc"
  | "added-asc"
  | "renewal-asc"
  | "renewal-desc"
  | "contract-value-desc"
  | "contract-value-asc"
  | "status-asc";

export const VENDOR_SORT_OPTIONS: { value: VendorSortKey; label: string }[] = [
  { value: "name-asc", label: "Name (A → Z)" },
  { value: "name-desc", label: "Name (Z → A)" },
  { value: "category-asc", label: "Category (A → Z)" },
  { value: "category-desc", label: "Category (Z → A)" },
  { value: "added-desc", label: "Date added (newest)" },
  { value: "added-asc", label: "Date added (oldest)" },
  { value: "renewal-asc", label: "Next renewal (soonest)" },
  { value: "renewal-desc", label: "Next renewal (latest)" },
  { value: "contract-value-desc", label: "Contract value (high → low)" },
  { value: "contract-value-asc", label: "Contract value (low → high)" },
  { value: "status-asc", label: "Status (A → Z)" },
];

export const DEFAULT_VENDOR_SORT: VendorSortKey = "name-asc";

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function nextRenewalDays(vendor: Vendor): number | null {
  const upcoming = vendor.contracts
    .filter((contract) => contract.endDate)
    .map((contract) => daysUntilEnd(contract.endDate));
  if (upcoming.length === 0) return null;
  return Math.min(...upcoming);
}

function totalContractValue(vendor: Vendor) {
  return vendor.contracts.reduce((sum, contract) => sum + (contract.value || 0), 0);
}

export function sortVendors(vendors: Vendor[], sortKey: VendorSortKey): Vendor[] {
  const sorted = [...vendors];

  sorted.sort((a, b) => {
    switch (sortKey) {
      case "name-asc":
        return compareText(a.name, b.name);
      case "name-desc":
        return compareText(b.name, a.name);
      case "category-asc":
        return compareText(a.category, b.category) || compareText(a.name, b.name);
      case "category-desc":
        return compareText(b.category, a.category) || compareText(a.name, b.name);
      case "added-desc":
        return (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || compareText(a.name, b.name);
      case "added-asc":
        return (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || compareText(a.name, b.name);
      case "renewal-asc": {
        const aDays = nextRenewalDays(a);
        const bDays = nextRenewalDays(b);
        if (aDays === null && bDays === null) return compareText(a.name, b.name);
        if (aDays === null) return 1;
        if (bDays === null) return -1;
        return aDays - bDays || compareText(a.name, b.name);
      }
      case "renewal-desc": {
        const aDays = nextRenewalDays(a);
        const bDays = nextRenewalDays(b);
        if (aDays === null && bDays === null) return compareText(a.name, b.name);
        if (aDays === null) return 1;
        if (bDays === null) return -1;
        return bDays - aDays || compareText(a.name, b.name);
      }
      case "contract-value-desc":
        return totalContractValue(b) - totalContractValue(a) || compareText(a.name, b.name);
      case "contract-value-asc":
        return totalContractValue(a) - totalContractValue(b) || compareText(a.name, b.name);
      case "status-asc":
        return compareText(a.status, b.status) || compareText(a.name, b.name);
      default:
        return compareText(a.name, b.name);
    }
  });

  return sorted;
}

export function vendorSortStorageKey(organizationId: string) {
  return `vendor-sort-${organizationId}`;
}

export function loadVendorSort(organizationId: string): VendorSortKey {
  if (!organizationId) return DEFAULT_VENDOR_SORT;
  const saved = localStorage.getItem(vendorSortStorageKey(organizationId));
  if (saved && VENDOR_SORT_OPTIONS.some((option) => option.value === saved)) {
    return saved as VendorSortKey;
  }
  return DEFAULT_VENDOR_SORT;
}

export function saveVendorSort(organizationId: string, sortKey: VendorSortKey) {
  if (!organizationId) return;
  localStorage.setItem(vendorSortStorageKey(organizationId), sortKey);
}
