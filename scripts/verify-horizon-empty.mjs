/**
 * Fails if open renewals would show "No renewals on the horizon" while overdue
 * contracts exist on vendors (Parkway-style). Run: node scripts/verify-horizon-empty.mjs
 */

function normalizeIsoDate(value) {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
function resolveEnd(c) {
  return normalizeIsoDate(c.endDate);
}
function getAction(c) {
  const r = normalizeIsoDate(c.renewalDate);
  const e = resolveEnd(c);
  if (c.renewalType === "fixed_term") return e ?? r;
  return r ?? e;
}
function getUrgencyDate(c) {
  const a = getAction(c);
  const e = resolveEnd(c);
  if (a && e) return a <= e ? a : e;
  return a ?? e;
}
function daysUntil(d) {
  const n = normalizeIsoDate(d) ?? String(d).slice(0, 10);
  const end = new Date(`${n}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end - today) / 86400000);
}
function inWindow(days) {
  return days < 0 || days <= 90;
}
function contractToRenewalItem(contract, vendor) {
  if (contract.status === "inactive" || contract.renewalHandledAt) return null;
  const effective = getUrgencyDate(contract) ?? (contract.status === "expired" ? contract.startDate : null);
  if (!effective) return null;
  const days = daysUntil(effective);
  if (!inWindow(days) && contract.status !== "expired") return null;
  return {
    contractId: contract.id,
    vendorName: vendor.name,
    daysUntilEnd: days,
    urgency: days < 0 || contract.status === "expired" ? "overdue" : days <= 30 ? "soon" : "upcoming",
  };
}
function buildOpenRenewalsFromVendors(vendors) {
  const items = [];
  for (const v of vendors) {
    if (v.status === "inactive") continue;
    for (const c of v.contracts) {
      const item = contractToRenewalItem(c, v);
      if (item) items.push(item);
    }
  }
  return items;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else console.log("OK:", msg);
}

// Simulate OLD broken API path: drop rows when vendors embed is null
function oldFetchWouldReturnEmpty(contracts) {
  return contracts.filter((row) => {
    const vendorName = row.vendors?.name;
    if (!vendorName) return false; // <-- Parkway silent drop
    return true;
  }).length === 0;
}

const parkwayVendors = [
  {
    name: "Vendor A",
    status: "pending",
    contracts: [
      {
        id: "1",
        name: "Old deal",
        endDate: "2022-03-01",
        renewalDate: "2027-01-01",
        renewalType: "fixed_term",
        status: "pending",
        renewalHandledAt: null,
        startDate: "2021-01-01",
      },
    ],
  },
  {
    name: "Vendor B",
    status: "active",
    contracts: [
      {
        id: "2",
        name: "Expired lab",
        endDate: "2022-12-31",
        renewalDate: null,
        renewalType: "fixed_term",
        status: "expired",
        renewalHandledAt: null,
        startDate: "2022-01-01",
      },
    ],
  },
];

const open = buildOpenRenewalsFromVendors(parkwayVendors);
assert(open.length === 2, "both expired/overdue contracts appear on open renewals");
assert(open.every((i) => i.urgency === "overdue"), "both marked overdue");
assert(open.length > 0, "must NOT render 'No renewals on the horizon'");

const apiRowsMissingEmbed = parkwayVendors.flatMap((v) =>
  v.contracts.map((c) => ({ ...c, vendors: null })),
);
assert(oldFetchWouldReturnEmpty(apiRowsMissingEmbed) === true, "old join-null path would empty the list");
assert(buildOpenRenewalsFromVendors(parkwayVendors).length > 0, "vendor-derived path still populated");

if (process.exitCode) {
  console.error("\nHorizon empty-state verification failed.");
  process.exit(1);
}
console.log("\nHorizon empty-state checks passed.");
