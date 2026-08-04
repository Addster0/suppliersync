import type { Vendor } from "../types";

/** Demo vendors created by seedSampleVendors (includes legacy/alternate names). */
export const KNOWN_SAMPLE_VENDOR_NAMES = new Set([
  "Northstar Supply Co.",
  "Brightline Services",
  "Brightside Services",
]);

export function isSampleVendor(vendor: Pick<Vendor, "name">): boolean {
  return KNOWN_SAMPLE_VENDOR_NAMES.has(vendor.name);
}

export function countSampleVendors(vendors: Vendor[]): number {
  return vendors.filter(isSampleVendor).length;
}
