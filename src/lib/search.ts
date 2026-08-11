import type { Vendor } from "../types";

/** Must match search_organization max in 028_abuse_prevention.sql */
export const MAX_SEARCH_QUERY_LENGTH = 100;

export function normalizeSearchQuery(query: string) {
  return query.trim().toLowerCase();
}

export function clampSearchQuery(query: string) {
  return query.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
}

export function vendorMatchesQuery(vendor: Vendor, query: string) {
  const q = normalizeSearchQuery(query);
  if (!q) return true;
  return (
    vendor.name.toLowerCase().includes(q) ||
    vendor.category.toLowerCase().includes(q) ||
    vendor.address.toLowerCase().includes(q) ||
    vendor.notes.toLowerCase().includes(q) ||
    (vendor.stickyNotes ?? []).some((note) => note.body.toLowerCase().includes(q))
  );
}

/** Lower score = better match (name starts with query ranks above category match). */
export function vendorMatchScore(vendor: Vendor, query: string) {
  const q = normalizeSearchQuery(query);
  if (!q) return 0;
  const name = vendor.name.toLowerCase();
  const category = vendor.category.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (category.includes(q)) return 3;
  if (vendor.address.toLowerCase().includes(q)) return 4;
  if ((vendor.stickyNotes ?? []).some((note) => note.body.toLowerCase().includes(q))) return 5;
  if (vendor.notes.toLowerCase().includes(q)) return 6;
  return 99;
}

export function filterAndRankVendors(vendors: Vendor[], query: string) {
  const q = normalizeSearchQuery(query);
  if (!q) return vendors;
  return vendors
    .filter((vendor) => vendorMatchesQuery(vendor, q))
    .sort((a, b) => vendorMatchScore(a, q) - vendorMatchScore(b, q) || a.name.localeCompare(b.name));
}

export function vendorToSearchResult(vendor: Vendor) {
  return {
    entityType: "vendor" as const,
    entityId: vendor.id,
    vendorId: vendor.id,
    vendorName: vendor.name,
    title: vendor.name,
    subtitle: vendor.category,
  };
}
