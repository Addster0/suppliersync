import type { Evaluation, Vendor } from "../types";
import { openPrintableHtml } from "./utils";

export type DigestPeriodType = "monthly" | "annual";

type SpendSnapshot = {
  entry_date: string;
  amount: number;
  entry_type: string;
  vendor_id: string;
};

type VendorRow = { id: string; name: string; category: string };

type EvaluationRow = {
  vendor_id: string;
  eval_date: string;
  score: number;
  criteria: Record<string, unknown> | null;
};

export type DigestReportData = {
  orgName: string;
  periodType: DigestPeriodType;
  periodLabel: string;
  compareLabel: string;
  currentSpend: number;
  previousSpend: number;
  spendChangePct: number | null;
  trendPoints: { label: string; amount: number }[];
  categoryBreakdown: { category: string; amount: number }[];
  topVendors: { name: string; category: string; amount: number }[];
  vendorScores: {
    vendorName: string;
    latestScore: number | null;
    trendDelta: number | null;
    orgRank: number;
    orgTotal: number;
  }[];
  vendorCount: number;
  evaluationCount: number;
};

function paymentTotal(entries: SpendSnapshot[]) {
  return entries.reduce((sum, entry) => (entry.entry_type === "payment" ? sum + entry.amount : sum), 0);
}

function formatDateForQuery(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStart(year: number, month: number) {
  return new Date(year, month, 1);
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function hasScorecard(criteria: Evaluation["criteria"]) {
  return Object.values(criteria).some((value) => typeof value === "number" && value >= 1 && value <= 5);
}

function resolveReportPeriod(periodType: DigestPeriodType, asOf = new Date()) {
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);

  if (periodType === "monthly") {
    const reportMonth = monthStart(today.getFullYear(), today.getMonth() - 1);
    const previousMonth = monthStart(reportMonth.getFullYear(), reportMonth.getMonth() - 1);
    return {
      periodStart: formatDateForQuery(reportMonth),
      periodEnd: formatDateForQuery(monthStart(reportMonth.getFullYear(), reportMonth.getMonth() + 1)),
      previousStart: formatDateForQuery(previousMonth),
      previousEnd: formatDateForQuery(reportMonth),
      periodLabel: monthLabel(reportMonth),
      compareLabel: `vs ${monthLabel(previousMonth)}`,
    };
  }

  const reportYear = today.getFullYear() - 1;
  const previousYear = reportYear - 1;
  return {
    periodStart: `${reportYear}-01-01`,
    periodEnd: `${reportYear + 1}-01-01`,
    previousStart: `${previousYear}-01-01`,
    previousEnd: `${reportYear}-01-01`,
    periodLabel: String(reportYear),
    compareLabel: `vs ${previousYear}`,
  };
}

function filterSpendByRange(entries: SpendSnapshot[], startInclusive: string, endExclusive: string) {
  return entries.filter((entry) => entry.entry_date >= startInclusive && entry.entry_date < endExclusive);
}

function vendorsToRows(vendors: Vendor[]): VendorRow[] {
  return vendors.map((vendor) => ({ id: vendor.id, name: vendor.name, category: vendor.category }));
}

function vendorsToSpend(vendors: Vendor[]): SpendSnapshot[] {
  return vendors.flatMap((vendor) =>
    vendor.ledger.map((entry) => ({
      entry_date: entry.date,
      amount: entry.amount,
      entry_type: entry.type,
      vendor_id: vendor.id,
    }))
  );
}

function vendorsToEvaluations(vendors: Vendor[]): EvaluationRow[] {
  return vendors.flatMap((vendor) =>
    vendor.evaluations.map((evaluation) => ({
      vendor_id: vendor.id,
      eval_date: evaluation.date,
      score: evaluation.score,
      criteria: evaluation.criteria as Record<string, unknown>,
    }))
  );
}

function buildTrendPoints(periodType: DigestPeriodType, entries: SpendSnapshot[], asOf = new Date()) {
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);

  if (periodType === "monthly") {
    const points: { label: string; amount: number }[] = [];
    for (let i = 5; i >= 0; i -= 1) {
      const start = monthStart(today.getFullYear(), today.getMonth() - 1 - i);
      const end = monthStart(start.getFullYear(), start.getMonth() + 1);
      points.push({
        label: start.toLocaleDateString("en-US", { month: "short" }),
        amount: paymentTotal(filterSpendByRange(entries, formatDateForQuery(start), formatDateForQuery(end))),
      });
    }
    return points;
  }

  const reportYear = today.getFullYear() - 1;
  return Array.from({ length: 12 }, (_, month) => {
    const start = monthStart(reportYear, month);
    const end = monthStart(reportYear, month + 1);
    return {
      label: start.toLocaleDateString("en-US", { month: "short" }),
      amount: paymentTotal(filterSpendByRange(entries, formatDateForQuery(start), formatDateForQuery(end))),
    };
  });
}

function categoryBreakdown(
  entries: SpendSnapshot[],
  vendors: VendorRow[],
  startInclusive: string,
  endExclusive: string
) {
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const totals = new Map<string, number>();

  for (const entry of filterSpendByRange(entries, startInclusive, endExclusive)) {
    if (entry.entry_type !== "payment") continue;
    const vendor = vendorMap.get(entry.vendor_id);
    const category = vendor?.category?.trim() || "Uncategorized";
    totals.set(category, (totals.get(category) ?? 0) + entry.amount);
  }

  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function topVendorsInPeriod(
  entries: SpendSnapshot[],
  vendors: VendorRow[],
  startInclusive: string,
  endExclusive: string,
  limit = 8
) {
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const totals = new Map<string, number>();

  for (const entry of filterSpendByRange(entries, startInclusive, endExclusive)) {
    if (entry.entry_type !== "payment") continue;
    totals.set(entry.vendor_id, (totals.get(entry.vendor_id) ?? 0) + entry.amount);
  }

  return [...totals.entries()]
    .map(([vendorId, amount]) => {
      const vendor = vendorMap.get(vendorId);
      return {
        name: vendor?.name ?? "Unknown vendor",
        category: vendor?.category ?? "Uncategorized",
        amount,
      };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

function buildVendorScores(
  evaluations: EvaluationRow[],
  vendors: VendorRow[],
  periodStart: string,
  periodEnd: string,
  previousStart: string,
  previousEnd: string
) {
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor.name]));
  const scorecardEvals = evaluations.filter((row) => hasScorecard(row.criteria as Evaluation["criteria"]));
  const byVendor = new Map<string, EvaluationRow[]>();

  for (const row of scorecardEvals) {
    const list = byVendor.get(row.vendor_id) ?? [];
    list.push(row);
    byVendor.set(row.vendor_id, list);
  }

  const ranked = [...byVendor.entries()]
    .map(([vendorId, rows]) => {
      const sorted = rows.slice().sort((a, b) => b.eval_date.localeCompare(a.eval_date));
      const latestInPeriod = sorted.find((row) => row.eval_date >= periodStart && row.eval_date < periodEnd);
      const latestOverall = sorted[0] ?? null;
      const latestScore = latestInPeriod?.score ?? latestOverall?.score ?? null;
      const previousInPeriod = sorted.find(
        (row) => row.eval_date >= previousStart && row.eval_date < previousEnd
      );
      const previousScore = previousInPeriod?.score ?? null;
      const trendDelta =
        latestScore != null && previousScore != null
          ? Math.round((latestScore - previousScore) * 10) / 10
          : null;

      return {
        vendorName: vendorMap.get(vendorId) ?? "Unknown vendor",
        latestScore,
        trendDelta,
        orgRank: 0,
        orgTotal: 0,
      };
    })
    .filter((row) => row.latestScore != null)
    .sort((a, b) => (b.latestScore ?? 0) - (a.latestScore ?? 0));

  ranked.forEach((row, index) => {
    row.orgRank = index + 1;
    row.orgTotal = ranked.length;
  });

  return ranked.slice(0, 10);
}

export function buildDigestReportFromVendors(params: {
  orgName: string;
  periodType: DigestPeriodType;
  vendors: Vendor[];
  asOf?: Date;
}): DigestReportData {
  const { orgName, periodType, vendors, asOf } = params;
  const vendorRows = vendorsToRows(vendors);
  const spendEntries = vendorsToSpend(vendors);
  const evaluations = vendorsToEvaluations(vendors);
  const period = resolveReportPeriod(periodType, asOf);

  const currentSpend = paymentTotal(
    filterSpendByRange(spendEntries, period.periodStart, period.periodEnd)
  );
  const previousSpend = paymentTotal(
    filterSpendByRange(spendEntries, period.previousStart, period.previousEnd)
  );

  return {
    orgName,
    periodType,
    periodLabel: period.periodLabel,
    compareLabel: period.compareLabel,
    currentSpend,
    previousSpend,
    spendChangePct: pctChange(currentSpend, previousSpend),
    trendPoints: buildTrendPoints(periodType, spendEntries, asOf),
    categoryBreakdown: categoryBreakdown(
      spendEntries,
      vendorRows,
      period.periodStart,
      period.periodEnd
    ),
    topVendors: topVendorsInPeriod(
      spendEntries,
      vendorRows,
      period.periodStart,
      period.periodEnd
    ),
    vendorScores: buildVendorScores(
      evaluations,
      vendorRows,
      period.periodStart,
      period.periodEnd,
      period.previousStart,
      period.previousEnd
    ),
    vendorCount: vendors.length,
    evaluationCount: evaluations.filter((row) =>
      hasScorecard(row.criteria as Evaluation["criteria"])
    ).length,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function svgBarChart(points: { label: string; amount: number }[]) {
  if (!points.length) return `<p class="muted">No spend logged.</p>`;
  const width = 560;
  const height = 180;
  const max = Math.max(...points.map((point) => point.amount), 1);
  const barWidth = Math.floor((width - 40) / points.length) - 8;
  const chartHeight = height - 40;
  const bars = points
    .map((point, index) => {
      const barHeight = Math.max(4, Math.round((point.amount / max) * chartHeight));
      const x = 24 + index * (barWidth + 8);
      const y = height - 28 - barHeight;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="#1d4ed8"/>
        <text x="${x + barWidth / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="#64748b">${escapeHtml(point.label)}</text>`;
    })
    .join("");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}</svg>`;
}

export function openDigestReportPreview(params: {
  workspaceName: string;
  vendors: Vendor[];
  periodType: DigestPeriodType;
}) {
  const data = buildDigestReportFromVendors({
    orgName: params.workspaceName,
    periodType: params.periodType,
    vendors: params.vendors,
  });

  const title =
    data.periodType === "monthly"
      ? `Monthly vendor report — ${data.periodLabel}`
      : `Annual vendor report — ${data.periodLabel}`;

  const topRows = data.topVendors
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(formatCurrency(row.amount))}</td></tr>`
    )
    .join("");

  const scoreRows = data.vendorScores
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.vendorName)}</td><td>${row.latestScore}/5</td><td>${row.trendDelta ?? "—"}</td><td>#${row.orgRank} of ${row.orgTotal}</td></tr>`
    )
    .join("");

  const categoryRows = data.categoryBreakdown
    .slice(0, 8)
    .map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${escapeHtml(formatCurrency(row.amount))}</td></tr>`)
    .join("");

  const changeText =
    data.spendChangePct == null
      ? "No prior spend"
      : `${data.spendChangePct >= 0 ? "↑" : "↓"} ${Math.abs(data.spendChangePct)}% ${escapeHtml(data.compareLabel)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #172033; margin: 32px; line-height: 1.5; }
    h1 { font-size: 28px; margin: 0 0 4px; }
    .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; margin: 24px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 8px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
    th { color: #64748b; font-weight: 700; }
    .stats { display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0; }
    .stat strong { display: block; font-size: 22px; }
    .stat span { color: #64748b; font-size: 13px; }
    .muted { color: #64748b; }
    @media print { body { margin: 18px; } }
  </style>
</head>
<body>
  <p class="meta">${escapeHtml(data.orgName)} · ${escapeHtml(title)}</p>
  <h1>${data.periodType === "monthly" ? "Monthly" : "Annual"} vendor report</h1>

  <div class="stats">
    <div class="stat"><strong>${escapeHtml(formatCurrency(data.currentSpend))}</strong><span>Period spend · ${changeText}</span></div>
    <div class="stat"><strong>${data.vendorCount}</strong><span>Vendors tracked</span></div>
    <div class="stat"><strong>${data.evaluationCount}</strong><span>Scorecard reviews</span></div>
  </div>

  <h2>Spend trend</h2>
  ${svgBarChart(data.trendPoints)}

  <h2>Spend by category</h2>
  ${categoryRows ? `<table><tr><th>Category</th><th>Spend</th></tr>${categoryRows}</table>` : `<p class="muted">No category spend.</p>`}

  <h2>Top vendors</h2>
  ${topRows ? `<table><tr><th>Vendor</th><th>Category</th><th>Spend</th></tr>${topRows}</table>` : `<p class="muted">No vendor spend.</p>`}

  <h2>Vendor scorecards</h2>
  ${scoreRows ? `<table><tr><th>Vendor</th><th>Score</th><th>Change</th><th>Rank</th></tr>${scoreRows}</table>` : `<p class="muted">No scorecards yet.</p>`}
</body>
</html>`;

  openPrintableHtml(html);
}
