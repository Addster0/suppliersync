import { buildAttentionItems, workspaceSpendSummary, complianceLabel } from "./attention";
import { topVendorsBySpend } from "./spend";
import { urgencyLabel } from "./renewals";
import type { RenewalItem, Vendor } from "../types";
import { money, openPrintableHtml } from "./utils";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function openClinicReport(params: {
  workspaceName: string;
  vendors: Vendor[];
  renewals: RenewalItem[];
}) {
  const { workspaceName, vendors, renewals } = params;
  const attention = buildAttentionItems(vendors, renewals);
  const spend = workspaceSpendSummary(vendors);
  const topSpend = topVendorsBySpend(vendors, 8);
  const generated = new Date().toLocaleString();
  const critical = attention.filter((item) => item.severity === "critical");
  const warning = attention.filter((item) => item.severity === "warning");
  const info = attention.filter((item) => item.severity === "info");

  const renewalRows = renewals
    .slice()
    .sort((a, b) => a.daysUntilEnd - b.daysUntilEnd)
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.vendorName)}</td><td>${escapeHtml(item.contractName)}</td><td>${escapeHtml(item.endDate)}</td><td>${escapeHtml(urgencyLabel(item.urgency))}</td><td>${escapeHtml(money(item.value))}</td></tr>`
    )
    .join("");

  const complianceGaps = vendors.flatMap((vendor) => {
    if (vendor.status !== "active") return [];
    const missingCoi = vendor.documents.some((doc) => doc.docType === "coi") ? null : "COI";
    const missingW9 = vendor.documents.some((doc) => doc.docType === "w9") ? null : "W-9";
    const expired = vendor.documents.filter((doc) => {
      if (!doc.expiresAt || doc.docType === "general") return false;
      const expiry = new Date(`${doc.expiresAt}T00:00:00`);
      return expiry < new Date();
    });
    const parts: string[] = [];
    if (missingCoi) parts.push("Missing COI");
    if (missingW9) parts.push("Missing W-9");
    for (const doc of expired) {
      parts.push(`${complianceLabel(doc.docType)} expired ${doc.expiresAt}`);
    }
    if (parts.length === 0) return [];
    return [`<tr><td>${escapeHtml(vendor.name)}</td><td>${parts.map(escapeHtml).join("<br>")}</td></tr>`];
  }).join("");

  const attentionList = (items: typeof attention) =>
    items.length
      ? `<ul>${items
          .map((item) => `<li><strong>${escapeHtml(item.title)}</strong> — ${escapeHtml(item.detail)}</li>`)
          .join("")}</ul>`
      : `<p class="muted">None</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(workspaceName)} — Clinic vendor report</title>
  <style>
    body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #172033; margin: 32px; line-height: 1.5; }
    h1 { font-size: 28px; margin: 0 0 4px; }
    .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; margin: 24px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 8px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
    th { color: #64748b; font-weight: 700; }
    .stats { display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0; }
    .stat { min-width: 120px; }
    .stat strong { display: block; font-size: 22px; }
    .stat span { color: #64748b; font-size: 13px; }
    .muted { color: #64748b; }
    ul { margin: 0; padding-left: 18px; }
    @media print { body { margin: 18px; } }
  </style>
</head>
<body>
  <p class="meta">${escapeHtml(workspaceName)} · Generated ${escapeHtml(generated)}</p>
  <h1>Clinic vendor report</h1>
  <p class="muted">Executive summary for owners and admins — renewals, compliance gaps, and spend.</p>

  <div class="stats">
    <div class="stat"><strong>${vendors.length}</strong><span>Vendors tracked</span></div>
    <div class="stat"><strong>${attention.length}</strong><span>Action items</span></div>
    <div class="stat"><strong>${renewals.length}</strong><span>Renewals on radar</span></div>
    <div class="stat"><strong>${escapeHtml(money(spend.ytd))}</strong><span>YTD spend logged</span></div>
  </div>

  <h2>Needs attention (${attention.length})</h2>
  <h3 style="font-size:14px;color:#b91c1c;margin:12px 0 4px;">Critical (${critical.length})</h3>
  ${attentionList(critical)}
  <h3 style="font-size:14px;color:#b45309;margin:12px 0 4px;">Warning (${warning.length})</h3>
  ${attentionList(warning)}
  <h3 style="font-size:14px;color:#1d4ed8;margin:12px 0 4px;">Info (${info.length})</h3>
  ${attentionList(info)}

  <h2>Renewals (${renewals.length})</h2>
  ${
    renewals.length
      ? `<table><tr><th>Vendor</th><th>Contract</th><th>End date</th><th>Status</th><th>Value</th></tr>${renewalRows}</table>`
      : `<p class="muted">No renewals in the current window.</p>`
  }

  <h2>Compliance gaps</h2>
  ${
    complianceGaps
      ? `<table><tr><th>Vendor</th><th>Issue</th></tr>${complianceGaps}</table>`
      : `<p class="muted">All active vendors have COI and W-9 on file with no expired compliance docs.</p>`
  }

  <h2>Top spend (YTD)</h2>
  ${
    topSpend.length
      ? `<table><tr><th>Vendor</th><th>Category</th><th>YTD spend</th></tr>${topSpend
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.vendor.name)}</td><td>${escapeHtml(row.vendor.category)}</td><td>${escapeHtml(money(row.total))}</td></tr>`
          )
          .join("")}</table>`
      : `<p class="muted">No spend logged yet.</p>`
  }
</body>
</html>`;

  openPrintableHtml(html);
}
