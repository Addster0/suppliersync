import {
  calculateRenewalLossFromContracts,
  type ContractSnapshot,
  type RenewalLossSummary,
} from "./renewalLossCalculator.ts";

export type DigestPeriodType = "monthly" | "annual";

export type { ContractSnapshot };

export type SpendSnapshot = {
  entry_date: string;
  amount: number;
  entry_type: string;
  vendor_id: string;
};

export type VendorRow = {
  id: string;
  name: string;
  category: string;
};

export type EvaluationRow = {
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
  periodStart: string;
  periodEnd: string;
  currentSpend: number;
  previousSpend: number;
  spendChangePct: number | null;
  trendPoints: { label: string; amount: number }[];
  categoryBreakdown: { category: string; amount: number }[];
  topVendors: { name: string; category: string; amount: number }[];
  vendorScores: {
    vendorId: string;
    vendorName: string;
    latestScore: number | null;
    previousScore: number | null;
    trendDelta: number | null;
    orgRank: number;
    orgTotal: number;
    history: { date: string; score: number }[];
  }[];
  vendorCount: number;
  evaluationCount: number;
  hasData: boolean;
  renewalLoss: RenewalLossSummary;
};

function paymentTotal(entries: SpendSnapshot[]) {
  return entries.reduce((sum, entry) => (entry.entry_type === "payment" ? sum + Number(entry.amount) : sum), 0);
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

function hasScorecardCriteria(criteria: Record<string, unknown> | null) {
  if (!criteria || typeof criteria !== "object") return false;
  return Object.values(criteria).some((value) => typeof value === "number" && value >= 1 && value <= 5);
}

export function resolveReportPeriod(periodType: DigestPeriodType, asOf = new Date()) {
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);

  if (periodType === "monthly") {
    const reportMonth = monthStart(today.getFullYear(), today.getMonth() - 1);
    const previousMonth = monthStart(reportMonth.getFullYear(), reportMonth.getMonth() - 1);
    const periodEnd = formatDateForQuery(monthStart(reportMonth.getFullYear(), reportMonth.getMonth() + 1));
    const previousEnd = formatDateForQuery(reportMonth);

    return {
      periodStart: formatDateForQuery(reportMonth),
      periodEnd,
      previousStart: formatDateForQuery(previousMonth),
      previousEnd,
      periodLabel: monthLabel(reportMonth),
      compareLabel: `vs ${monthLabel(previousMonth)}`,
      digestPeriod: formatDateForQuery(reportMonth),
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
    digestPeriod: `${reportYear}-01-01`,
  };
}

function filterSpendByRange(entries: SpendSnapshot[], startInclusive: string, endExclusive: string) {
  return entries.filter((entry) => entry.entry_date >= startInclusive && entry.entry_date < endExclusive);
}

function buildTrendPoints(
  periodType: DigestPeriodType,
  entries: SpendSnapshot[],
  asOf = new Date()
): { label: string; amount: number }[] {
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);

  if (periodType === "monthly") {
    const points: { label: string; amount: number }[] = [];
    for (let i = 5; i >= 0; i -= 1) {
      const start = monthStart(today.getFullYear(), today.getMonth() - 1 - i);
      const end = monthStart(start.getFullYear(), start.getMonth() + 1);
      const slice = filterSpendByRange(entries, formatDateForQuery(start), formatDateForQuery(end));
      points.push({
        label: start.toLocaleDateString("en-US", { month: "short" }),
        amount: paymentTotal(slice),
      });
    }
    return points;
  }

  const reportYear = today.getFullYear() - 1;
  const points: { label: string; amount: number }[] = [];
  for (let month = 0; month < 12; month += 1) {
    const start = monthStart(reportYear, month);
    const end = monthStart(reportYear, month + 1);
    const slice = filterSpendByRange(entries, formatDateForQuery(start), formatDateForQuery(end));
    points.push({
      label: start.toLocaleDateString("en-US", { month: "short" }),
      amount: paymentTotal(slice),
    });
  }
  return points;
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
    totals.set(category, (totals.get(category) ?? 0) + Number(entry.amount));
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
    totals.set(entry.vendor_id, (totals.get(entry.vendor_id) ?? 0) + Number(entry.amount));
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
  const scorecardEvals = evaluations.filter((row) => hasScorecardCriteria(row.criteria));

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

      const history = sorted
        .slice(0, 6)
        .reverse()
        .map((row) => ({ date: row.eval_date, score: row.score }));

      return {
        vendorId,
        vendorName: vendorMap.get(vendorId) ?? "Unknown vendor",
        latestScore,
        previousScore,
        trendDelta,
        orgRank: 0,
        orgTotal: 0,
        history,
      };
    })
    .filter((row) => row.latestScore != null)
    .sort((a, b) => (b.latestScore ?? 0) - (a.latestScore ?? 0));

  const orgTotal = ranked.length;
  ranked.forEach((row, index) => {
    row.orgRank = index + 1;
    row.orgTotal = orgTotal;
  });

  return ranked.slice(0, 10);
}

export function buildDigestReportData(params: {
  orgName: string;
  periodType: DigestPeriodType;
  vendors: VendorRow[];
  spendEntries: SpendSnapshot[];
  evaluations: EvaluationRow[];
  contracts?: ContractSnapshot[];
  asOf?: Date;
}): DigestReportData {
  const { orgName, periodType, vendors, spendEntries, evaluations, contracts = [], asOf } = params;
  const period = resolveReportPeriod(periodType, asOf);

  const currentEntries = filterSpendByRange(spendEntries, period.periodStart, period.periodEnd);
  const previousEntries = filterSpendByRange(spendEntries, period.previousStart, period.previousEnd);

  const currentSpend = paymentTotal(currentEntries);
  const previousSpend = paymentTotal(previousEntries);
  const spendChangePct = pctChange(currentSpend, previousSpend);

  const categoryBreakdownRows = categoryBreakdown(
    spendEntries,
    vendors,
    period.periodStart,
    period.periodEnd
  );
  const topVendors = topVendorsInPeriod(
    spendEntries,
    vendors,
    period.periodStart,
    period.periodEnd
  );
  const vendorScores = buildVendorScores(
    evaluations,
    vendors,
    period.periodStart,
    period.periodEnd,
    period.previousStart,
    period.previousEnd
  );

  const hasData =
    currentSpend > 0 ||
    previousSpend > 0 ||
    categoryBreakdownRows.length > 0 ||
    vendorScores.length > 0 ||
    vendors.length > 0;

  return {
    orgName,
    periodType,
    periodLabel: period.periodLabel,
    compareLabel: period.compareLabel,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    currentSpend,
    previousSpend,
    spendChangePct,
    trendPoints: buildTrendPoints(periodType, spendEntries, asOf),
    categoryBreakdown: categoryBreakdownRows,
    topVendors,
    vendorScores,
    vendorCount: vendors.length,
    evaluationCount: evaluations.filter((row) => hasScorecardCriteria(row.criteria)).length,
    hasData,
    renewalLoss: calculateRenewalLossFromContracts(contracts),
  };
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function changeBadge(pct: number | null) {
  if (pct == null) return `<span style="color:#64748b;">No prior spend</span>`;
  const up = pct >= 0;
  const color = up ? "#b45309" : "#15803d";
  const arrow = up ? "↑" : "↓";
  return `<span style="color:${color};font-weight:700;">${arrow} ${Math.abs(pct)}%</span>`;
}

function svgBarChart(points: { label: string; amount: number }[], width = 520, height = 180) {
  if (!points.length) {
    return `<p style="color:#64748b;font-size:14px;">No spend logged in this window.</p>`;
  }

  const max = Math.max(...points.map((point) => point.amount), 1);
  const barWidth = Math.floor((width - 40) / points.length) - 8;
  const chartHeight = height - 40;

  const bars = points
    .map((point, index) => {
      const barHeight = Math.max(4, Math.round((point.amount / max) * chartHeight));
      const x = 24 + index * (barWidth + 8);
      const y = height - 28 - barHeight;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="#1d4ed8" opacity="0.88"/>
        <text x="${x + barWidth / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="#64748b">${escapeHtml(point.label)}</text>`;
    })
    .join("");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Spend trend chart">${bars}</svg>`;
}

function svgHorizontalBars(rows: { label: string; amount: number }[], width = 520) {
  if (!rows.length) {
    return `<p style="color:#64748b;font-size:14px;">No category spend in this period.</p>`;
  }

  const max = Math.max(...rows.map((row) => row.amount), 1);
  const rowHeight = 28;
  const height = rows.length * rowHeight + 8;
  const labelWidth = 140;
  const barMaxWidth = width - labelWidth - 90;

  const items = rows
    .slice(0, 6)
    .map((row, index) => {
      const y = index * rowHeight + 6;
      const barWidth = Math.max(6, Math.round((row.amount / max) * barMaxWidth));
      return `<text x="0" y="${y + 16}" font-size="12" fill="#334155">${escapeHtml(row.label)}</text>
        <rect x="${labelWidth}" y="${y + 4}" width="${barWidth}" height="16" rx="4" fill="#6366f1" opacity="0.9"/>
        <text x="${labelWidth + barWidth + 8}" y="${y + 16}" font-size="12" fill="#475569">${escapeHtml(formatCurrency(row.amount))}</text>`;
    })
    .join("");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Category spend breakdown">${items}</svg>`;
}

function svgScoreTrend(history: { date: string; score: number }[], width = 220, height = 80) {
  if (history.length < 2) {
    return `<span style="color:#94a3b8;font-size:12px;">—</span>`;
  }

  const padding = 8;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const minScore = 1;
  const maxScore = 5;

  const points = history.map((point, index) => {
    const x = padding + (index / (history.length - 1)) * innerW;
    const y = padding + innerH - ((point.score - minScore) / (maxScore - minScore)) * innerH;
    return `${x},${y}`;
  });

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Score trend">
    <polyline fill="none" stroke="#1d4ed8" stroke-width="2" points="${points.join(" ")}"/>
  </svg>`;
}

export function buildDigestReportHtml(params: {
  data: DigestReportData;
  appUrl: string;
  isTest: boolean;
}) {
  const { data, appUrl, isTest } = params;
  const title =
    data.periodType === "monthly"
      ? `Monthly vendor report — ${data.periodLabel}`
      : `Annual vendor report — ${data.periodLabel}`;

  const renewalsUrl = `${appUrl.replace(/\/$/, "")}/app/renewals`;
  const testBanner = isTest
    ? `<p style="margin:0 0 16px;padding:12px 14px;background:#fef3c7;border-radius:8px;color:#92400e;font-size:14px;">
        This is a test email — scheduled ${data.periodType} reports use the same format.
      </p>`
    : "";

  const topVendorRows = data.topVendors
    .map(
      (row) =>
        `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#172033;">${escapeHtml(row.name)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;">${escapeHtml(row.category)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#172033;text-align:right;font-weight:700;">${escapeHtml(formatCurrency(row.amount))}</td>
        </tr>`
    )
    .join("");

  const scoreRows = data.vendorScores
    .map((row) => {
      const trend =
        row.trendDelta == null
          ? `<span style="color:#94a3b8;">—</span>`
          : row.trendDelta >= 0
            ? `<span style="color:#15803d;">+${row.trendDelta}</span>`
            : `<span style="color:#b91c1c;">${row.trendDelta}</span>`;

      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#172033;">${escapeHtml(row.vendorName)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;">${row.latestScore ?? "—"}/5</td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:center;">${trend}</td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:center;color:#475569;">#${row.orgRank} of ${row.orgTotal}</td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;">${svgScoreTrend(row.history)}</td>
      </tr>`;
    })
    .join("");

  const renewalLossRows = data.renewalLoss.lineItems
    .slice(0, 10)
    .map(
      (row) =>
        `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#172033;">${escapeHtml(row.contractName)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;">${escapeHtml(row.vendorName)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#b91c1c;">${escapeHtml(formatCurrency(row.estimatedAnnualLoss))}/yr</td>
        </tr>`,
    )
    .join("");

  const scheduleNote =
    data.periodType === "monthly"
      ? "Sent on the 1st of each month to workspace owners and admins when monthly reports are enabled."
      : "Sent on January 1 to workspace owners and admins when annual reports are enabled.";

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Inter,Segoe UI,sans-serif;">
  <div style="max-width:640px;margin:24px auto;padding:28px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1d4ed8;">SupplierSync</p>
    <h1 style="margin:0 0 6px;font-size:24px;color:#172033;">${escapeHtml(title)}</h1>
    <p style="margin:0 0 20px;color:#64748b;font-size:14px;">${escapeHtml(data.orgName)} · ${data.periodType === "monthly" ? "Month in review" : "Year in review"}</p>
    ${testBanner}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="padding:16px;background:#f8fafc;border-radius:12px;width:33%;">
          <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Spend</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:#172033;">${escapeHtml(formatCurrency(data.currentSpend))}</p>
          <p style="margin:6px 0 0;font-size:13px;">${changeBadge(data.spendChangePct)} ${escapeHtml(data.compareLabel)}</p>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:16px;background:#f8fafc;border-radius:12px;width:33%;">
          <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Vendors</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:#172033;">${data.vendorCount}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#64748b;">Tracked in workspace</p>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:16px;background:#f8fafc;border-radius:12px;width:33%;">
          <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Scorecards</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:#172033;">${data.evaluationCount}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#64748b;">Reviews on file</p>
        </td>
      </tr>
    </table>
    ${
      data.renewalLoss.totalEstimatedAnnualLoss > 0
        ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td style="padding:16px;background:#fff7ed;border-radius:12px;border:1px solid #fed7aa;">
                <p style="margin:0 0 4px;font-size:12px;color:#9a3412;text-transform:uppercase;letter-spacing:0.05em;">Renewal savings at risk</p>
                <p style="margin:0;font-size:22px;font-weight:700;color:#c2410c;">${escapeHtml(formatCurrency(data.renewalLoss.totalEstimatedAnnualLoss))}/yr</p>
                <p style="margin:6px 0 0;font-size:13px;color:#9a3412;">${data.renewalLoss.atRiskContractCount} out-of-date contract${data.renewalLoss.atRiskContractCount === 1 ? "" : "s"} · ~${data.renewalLoss.savingsRatePercent}% typical renegotiation savings</p>
              </td>
            </tr>
          </table>`
        : ""
    }

    <h2 style="margin:0 0 8px;font-size:16px;color:#172033;">Spend trend</h2>
    <p style="margin:0 0 12px;color:#64748b;font-size:14px;">${data.periodType === "monthly" ? "Last 6 months of payment spend" : `${data.periodLabel} monthly spend`}</p>
    ${svgBarChart(data.trendPoints)}

    <h2 style="margin:28px 0 8px;font-size:16px;color:#172033;">Spend by category</h2>
    ${svgHorizontalBars(
      data.categoryBreakdown.map((row) => ({ label: row.category, amount: row.amount }))
    )}

    <h2 style="margin:28px 0 8px;font-size:16px;color:#172033;">Top vendors</h2>
    ${
      data.topVendors.length
        ? `<table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <th style="text-align:left;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Vendor</th>
              <th style="text-align:left;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Category</th>
              <th style="text-align:right;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Spend</th>
            </tr>
            ${topVendorRows}
          </table>`
        : `<p style="color:#64748b;font-size:14px;">No vendor spend logged in this period.</p>`
    }

    <h2 style="margin:28px 0 8px;font-size:16px;color:#172033;">Contract renewal savings at risk</h2>
    ${
      data.renewalLoss.totalEstimatedAnnualLoss > 0
        ? `<p style="margin:0 0 12px;color:#64748b;font-size:14px;">Estimated annual savings left on the table if out-of-date contracts are not renegotiated or restated.</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <th style="text-align:left;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Contract</th>
              <th style="text-align:left;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Vendor</th>
              <th style="text-align:right;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Est. yearly loss</th>
            </tr>
            ${renewalLossRows}
          </table>
          <p style="margin:12px 0 0;color:#94a3b8;font-size:12px;">Illustrative estimate only — not financial or legal advice.</p>`
        : `<p style="color:#64748b;font-size:14px;">No out-of-date contracts detected — renewals look current.</p>`
    }

    <h2 style="margin:28px 0 8px;font-size:16px;color:#172033;">Vendor scorecards</h2>
    <p style="margin:0 0 12px;color:#64748b;font-size:14px;">Latest scores ranked within your workspace, with trend vs prior period.</p>
    ${
      data.vendorScores.length
        ? `<table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <th style="text-align:left;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Vendor</th>
              <th style="text-align:center;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Score</th>
              <th style="text-align:center;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Change</th>
              <th style="text-align:center;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Rank</th>
              <th style="text-align:left;padding:8px 0;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Trend</th>
            </tr>
            ${scoreRows}
          </table>`
        : `<p style="color:#64748b;font-size:14px;">No scorecard reviews yet — complete vendor scorecards to see rankings here.</p>`
    }

    <p style="margin:28px 0 0;">
      <a href="${renewalsUrl}" style="display:inline-block;padding:12px 18px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:14px;">
        Open SupplierSync
      </a>
    </p>
    <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">${scheduleNote}</p>
  </div>
</body>
</html>`;
}

export function shouldRunScheduledDigest(periodType: DigestPeriodType, asOf = new Date()) {
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);
  if (periodType === "monthly") return today.getDate() === 1;
  return today.getMonth() === 0 && today.getDate() === 1;
}

export { resolveReportPeriod as digestPeriodForType };
