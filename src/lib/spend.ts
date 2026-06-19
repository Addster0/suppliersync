import type { LedgerEntry, Vendor } from "../types";

export function ledgerPaymentTotal(entries: LedgerEntry[]) {
  return entries.reduce((sum, entry) => (entry.type === "payment" ? sum + entry.amount : sum), 0);
}

export function vendorNetLedgerBalance(entries: LedgerEntry[]) {
  return entries.reduce((sum, entry) => {
    return entry.type === "payment" ? sum - entry.amount : sum + entry.amount;
  }, 0);
}

export function vendorYtdSpend(vendor: Vendor, year = new Date().getFullYear()) {
  const start = `${year}-01-01`;
  return ledgerPaymentTotal(vendor.ledger.filter((entry) => entry.date >= start));
}

export function topVendorsBySpend(vendors: Vendor[], limit = 5) {
  return vendors
    .map((vendor) => ({ vendor, total: vendorYtdSpend(vendor) }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
