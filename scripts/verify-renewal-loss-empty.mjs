/**
 * Regression: Parkway-style renewals empty state + vendors-with-contracts count.
 * Mirrors production helpers (no bundler). Run: node scripts/verify-renewal-loss-empty.mjs
 */

function normalizeIsoDate(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
function resolveContractEndDate(contract) {
  const endDate = normalizeIsoDate(contract.endDate ?? null);
  if (endDate) return endDate;
  const startDate = normalizeIsoDate(contract.startDate ?? null);
  if (startDate && contract.termMonths && contract.termMonths > 0) {
    const date = new Date(`${startDate}T00:00:00`);
    date.setMonth(date.getMonth() + contract.termMonths);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}
function getContractActionDate(contract) {
  const renewalDate = normalizeIsoDate(contract.renewalDate);
  const endDate = resolveContractEndDate(contract);
  if (contract.renewalType === "fixed_term") return endDate ?? renewalDate;
  if (renewalDate) return renewalDate;
  return endDate;
}
function getContractUrgencyDate(contract) {
  const actionDate = getContractActionDate(contract);
  const endDate = resolveContractEndDate(contract);
  if (actionDate && endDate) return actionDate <= endDate ? actionDate : endDate;
  return actionDate ?? endDate;
}
function daysUntilEnd(endDate) {
  const normalized = normalizeIsoDate(endDate) ?? String(endDate).slice(0, 10);
  const end = new Date(`${normalized}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}
function isInOpenRenewalsWindow(daysUntil) {
  if (daysUntil < 0) return true;
  return daysUntil <= 90;
}
function isContractOverdue(contract) {
  if (contract.renewalHandledAt) return false;
  if (contract.status === "inactive") return false;
  if (contract.status === "expired") return true;
  const urgencyDate = getContractUrgencyDate(contract);
  if (!urgencyDate) return false;
  return daysUntilEnd(urgencyDate) < 0;
}
function safeContractValue(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function contractToRenewalItem(contract, vendor) {
  if (contract.status === "inactive") return null;
  const overdue = isContractOverdue(contract);
  const urgencyDate = getContractUrgencyDate(contract);
  let effectiveDate =
    urgencyDate ??
    normalizeIsoDate(contract.endDate) ??
    normalizeIsoDate(contract.renewalDate) ??
    normalizeIsoDate(contract.startDate) ??
    null;
  if (!effectiveDate) {
    if (!overdue && contract.status !== "expired") return null;
    effectiveDate = "1970-01-01";
  }
  const days = daysUntilEnd(effectiveDate);
  const daysForWindow = Number.isFinite(days) ? days : -9999;
  if (!overdue && contract.status !== "expired" && !isInOpenRenewalsWindow(daysForWindow)) {
    return null;
  }
  return {
    contractId: contract.id,
    daysUntilEnd: daysForWindow,
    urgency: overdue || contract.status === "expired" || daysForWindow < 0 ? "overdue" : "upcoming",
    status: contract.status,
  };
}

function buildOpenRenewalsFromVendors(vendors) {
  const items = [];
  for (const vendor of vendors) {
    if (vendor.status === "inactive") continue;
    for (const contract of vendor.contracts) {
      if (contract.renewalHandledAt) continue;
      const item = contractToRenewalItem(contract, vendor);
      if (item) items.push(item);
    }
  }
  return items;
}

function calculateRenewalLoss(vendors) {
  const lineItems = [];
  for (const vendor of vendors) {
    if (vendor.status === "inactive") continue;
    for (const contract of vendor.contracts) {
      if (contract.renewalHandledAt || contract.status === "inactive") continue;
      const overdue = isContractOverdue(contract);
      const expired = contract.status === "expired";
      if (!overdue && !expired) continue;
      const annualValue = safeContractValue(contract.value);
      lineItems.push({
        contractId: contract.id,
        annualValue,
        estimatedAnnualLoss: Math.round(annualValue * 0.12),
      });
    }
  }
  return {
    atRiskContractCount: lineItems.length,
    totalEstimatedAnnualLoss: lineItems.reduce((s, i) => s + i.estimatedAnnualLoss, 0),
    lineItems,
  };
}

function workspaceSpendSummary(vendors) {
  const trackedVendors = vendors.filter((v) => v.contracts.length > 0).length;
  const vendorsWithSpend = vendors.filter((v) => v.ledger.length > 0).length;
  return { trackedVendors, vendorsWithSpend, vendorCount: vendors.length };
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else console.log("OK:", msg);
}

const vendors = [
  {
    status: "pending",
    ledger: [{ id: "1" }],
    contracts: [
      {
        id: "c1",
        endDate: "2022-06-30",
        renewalDate: "2027-01-01",
        renewalType: "fixed_term",
        status: "pending",
        value: 0,
        renewalHandledAt: null,
      },
    ],
  },
  {
    status: "active",
    ledger: [],
    contracts: [
      {
        id: "c2",
        endDate: "2022-12-31",
        renewalDate: null,
        renewalType: "fixed_term",
        status: "active",
        value: 2400,
        renewalHandledAt: null,
      },
    ],
  },
  { status: "active", ledger: [{ id: "2" }], contracts: [] },
  { status: "active", ledger: [], contracts: [] },
];
while (vendors.length < 18) {
  vendors.push({ status: "active", ledger: [], contracts: [] });
}
for (let i = 0; i < 7; i++) {
  vendors[3 + i] = {
    status: "active",
    ledger: [],
    contracts: [
      {
        id: `extra-${i}`,
        endDate: "2022-01-15",
        renewalDate: null,
        renewalType: "fixed_term",
        status: "pending",
        value: 500,
        renewalHandledAt: null,
      },
    ],
  };
}

// Expired status + future review date must still appear (old window bug).
vendors[10] = {
  status: "active",
  ledger: [],
  contracts: [
    {
      id: "expired-future-review",
      endDate: null,
      renewalDate: "2027-06-01",
      renewalType: "auto_renew",
      status: "expired",
      value: 1200,
      renewalHandledAt: null,
    },
  ],
};

const spend = workspaceSpendSummary(vendors);
assert(spend.vendorCount === 18, "18 total vendors");
assert(spend.trackedVendors === 10, "10 vendors with contracts (not spend)");
assert(spend.vendorsWithSpend === 2, "spend count stays separate");

const open = buildOpenRenewalsFromVendors(vendors);
assert(open.length >= 10, "open renewals includes all overdue/expired contracts");
assert(
  open.some((i) => i.contractId === "expired-future-review"),
  "expired + future review date stays on open renewals",
);
assert(
  open.some((i) => i.contractId === "c1" && i.urgency === "overdue"),
  "2022 fixed-term with future leftover review still overdue",
);

const summary = calculateRenewalLoss(vendors);
assert(summary.atRiskContractCount === 10, "all contracted vendors' overdue contracts at risk");
assert(summary.lineItems.some((i) => i.contractId === "c1"), "zero-value 2022 contract still detected");
assert(summary.atRiskContractCount > 0, "must not show 'No out-of-date contracts detected'");
assert(
  summary.totalEstimatedAnnualLoss ===
    Math.round(2400 * 0.12) + Math.round(500 * 0.12) * 7 + Math.round(1200 * 0.12),
  "valued contracts contribute dollars",
);

if (process.exitCode) {
  console.error("\nVerification failed.");
  process.exit(1);
}
console.log("\nAll checks passed.");
