import type { OrganizationExport } from "../api/export";
import { complianceLabel } from "./attention";
import {
  CONTRACT_START_LABEL,
  daysUntilEnd,
  formatDaysUntil,
  getContractActionDate,
  getContractDateLabel,
  renewalTypeLabel,
} from "./renewals";
import { ledgerPaymentTotal, topVendorsBySpend, vendorYtdSpend } from "./spend";
import type { Vendor } from "../types";
import { downloadBlob, formatFileSize, money, prettyDate } from "./utils";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function orgSlug(orgName: string): string {
  return orgName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function renderVendorNotes(vendor: Vendor): string {
  const notes = (vendor.stickyNotes ?? []).filter((note) => note.body.trim());
  if (!notes.length && !vendor.notes.trim()) return "";
  if (notes.length) {
    return notes.map((note) => `<p>${escapeHtml(note.body)}</p>`).join("");
  }
  return `<p>${escapeHtml(vendor.notes)}</p>`;
}

export function organizationReportFilename(orgName: string, exportedAt = new Date()): string {
  const date = exportedAt.toISOString().slice(0, 10);
  return `suppliersync-report-${orgSlug(orgName) || "workspace"}-${date}.html`;
}

const REPORT_STYLES = `
  body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #172033; margin: 32px; line-height: 1.5; background: #ffffff; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; margin: 28px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  h3 { font-size: 18px; margin: 24px 0 6px; color: #172033; }
  .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  .lead { color: #475569; font-size: 15px; max-width: 720px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 8px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
  th { color: #64748b; font-weight: 700; }
  .stats { display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0 24px; }
  .stat { min-width: 120px; }
  .stat strong { display: block; font-size: 22px; color: #172033; }
  .stat span { color: #64748b; font-size: 13px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 700; text-transform: capitalize; }
  .muted { color: #64748b; }
  ul { margin: 0; padding-left: 18px; }
  .vendor-block { page-break-inside: avoid; margin-bottom: 32px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; }
  .vendor-block:last-child { border-bottom: none; }
  .footer-note { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #64748b; }
  @media print {
    body { margin: 18px; }
    .vendor-block { page-break-inside: avoid; }
  }
`;

function formatExportDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function workspaceYtdSpend(vendors: Vendor[]): number {
  return vendors.reduce((sum, vendor) => sum + vendorYtdSpend(vendor), 0);
}

function renderContacts(vendor: Vendor): string {
  if (!vendor.contacts.length) return `<p class="muted">No contacts listed.</p>`;
  const rows = vendor.contacts
    .map(
      (contact) =>
        `<tr><td>${escapeHtml(contact.name)}</td><td>${escapeHtml(contact.role || "—")}</td><td>${escapeHtml(contact.email || "—")}</td><td>${escapeHtml(contact.phone || "—")}</td></tr>`
    )
    .join("");
  return `<table><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th></tr>${rows}</table>`;
}

function renderContracts(vendor: Vendor): string {
  if (!vendor.contracts.length) return `<p class="muted">No contracts on file.</p>`;
  const rows = vendor.contracts
    .map((contract) => {
      const actionDate = getContractActionDate(contract);
      const renewalInfo = actionDate
        ? `${escapeHtml(getContractDateLabel(contract.renewalType))}: ${escapeHtml(prettyDate(actionDate))} (${escapeHtml(formatDaysUntil(daysUntilEnd(actionDate), contract.renewalType))})`
        : "—";
      const notice =
        contract.noticePeriodDays != null ? `${contract.noticePeriodDays} days notice` : "—";
      const fileMeta = contract.file
        ? `<br><span class="muted">File: ${escapeHtml(contract.file.fileName)} (${escapeHtml(formatFileSize(contract.file.fileSize))})</span>`
        : "";
      return `<tr>
        <td>${escapeHtml(contract.name)}${fileMeta}</td>
        <td>${escapeHtml(renewalTypeLabel(contract.renewalType))}</td>
        <td>${escapeHtml(prettyDate(contract.startDate))}</td>
        <td>${renewalInfo}</td>
        <td>${escapeHtml(notice)}</td>
        <td>${escapeHtml(money(contract.value))}</td>
        <td><span class="pill">${escapeHtml(contract.status)}</span></td>
      </tr>`;
    })
    .join("");
  return `<table><tr><th>Contract</th><th>Type</th><th>${escapeHtml(CONTRACT_START_LABEL)}</th><th>Renewal / review</th><th>Notice</th><th>Value</th><th>Status</th></tr>${rows}</table>`;
}

function renderDocuments(vendor: Vendor): string {
  if (!vendor.documents.length) return `<p class="muted">No documents uploaded.</p>`;
  const items = vendor.documents
    .map((doc) => {
      const expiry = doc.expiresAt ? ` · expires ${escapeHtml(prettyDate(doc.expiresAt))}` : "";
      return `<li>${escapeHtml(doc.fileName)} · ${escapeHtml(complianceLabel(doc.docType))}${expiry} · ${escapeHtml(formatFileSize(doc.fileSize))} · added ${escapeHtml(prettyDate(doc.createdAt.slice(0, 10)))}</li>`;
    })
    .join("");
  return `<ul>${items}</ul>`;
}

function renderSpend(vendor: Vendor): string {
  if (!vendor.ledger.length) return `<p class="muted">No spend entries logged.</p>`;
  const ytd = vendorYtdSpend(vendor);
  const payments = ledgerPaymentTotal(vendor.ledger);
  const rows = vendor.ledger
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(prettyDate(entry.date))}</td><td>${escapeHtml(entry.description)}</td><td>${escapeHtml(money(entry.amount))}</td><td>${escapeHtml(entry.type)}</td></tr>`
    )
    .join("");
  return `<p class="muted">YTD payments: ${escapeHtml(money(ytd))} · All-time payments: ${escapeHtml(money(payments))}</p>
    <table><tr><th>Date</th><th>Description</th><th>Amount</th><th>Type</th></tr>${rows}</table>`;
}

function renderEvaluations(vendor: Vendor): string {
  if (!vendor.evaluations.length) return "";
  const rows = vendor.evaluations
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(
      (evaluation) =>
        `<tr><td>${escapeHtml(prettyDate(evaluation.date))}</td><td>${evaluation.score}/100</td><td>${escapeHtml(evaluation.recommendation.replace(/_/g, " "))}</td><td>${escapeHtml(evaluation.reviewerName || "—")}</td><td>${evaluation.notes ? escapeHtml(evaluation.notes) : "—"}</td></tr>`
    )
    .join("");
  return `<h4 style="font-size:14px;color:#475569;margin:16px 0 6px;">Scorecards (${vendor.evaluations.length})</h4>
    <table><tr><th>Date</th><th>Score</th><th>Recommendation</th><th>Reviewer</th><th>Notes</th></tr>${rows}</table>`;
}

function renderVendorBlock(vendor: Vendor): string {
  const ytdSpend = vendorYtdSpend(vendor);
  return `<section class="vendor-block">
    <h3>${escapeHtml(vendor.name)}</h3>
    <p class="muted">${escapeHtml(vendor.category)} · <span class="pill">${escapeHtml(vendor.status)}</span>${vendor.address ? ` · ${escapeHtml(vendor.address)}` : ""}${ytdSpend > 0 ? ` · YTD spend ${escapeHtml(money(ytdSpend))}` : ""}</p>
    ${renderVendorNotes(vendor)}

    <h4 style="font-size:14px;color:#475569;margin:16px 0 6px;">Contacts (${vendor.contacts.length})</h4>
    ${renderContacts(vendor)}

    <h4 style="font-size:14px;color:#475569;margin:16px 0 6px;">Contracts (${vendor.contracts.length})</h4>
    ${renderContracts(vendor)}

    <h4 style="font-size:14px;color:#475569;margin:16px 0 6px;">Documents (${vendor.documents.length})</h4>
    ${renderDocuments(vendor)}

    <h4 style="font-size:14px;color:#475569;margin:16px 0 6px;">Spend (${vendor.ledger.length})</h4>
    ${renderSpend(vendor)}

    ${renderEvaluations(vendor)}
  </section>`;
}

export function buildOrganizationExportHtml(data: OrganizationExport): string {
  const vendors = data.vendors as Vendor[];
  const orgName = data.organization.name;
  const exportedLabel = formatExportDate(data.exportedAt);
  const totalContacts = vendors.reduce((sum, vendor) => sum + vendor.contacts.length, 0);
  const totalContracts = vendors.reduce((sum, vendor) => sum + vendor.contracts.length, 0);
  const totalDocuments = vendors.reduce((sum, vendor) => sum + vendor.documents.length, 0);
  const ytdSpend = workspaceYtdSpend(vendors);
  const topSpend = topVendorsBySpend(vendors, 10);

  const vendorDirectory = vendors.length
    ? `<table><tr><th>Vendor</th><th>Category</th><th>Status</th><th>Contacts</th><th>Contracts</th></tr>${vendors
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (vendor) =>
            `<tr><td>${escapeHtml(vendor.name)}</td><td>${escapeHtml(vendor.category)}</td><td>${escapeHtml(vendor.status)}</td><td>${vendor.contacts.length}</td><td>${vendor.contracts.length}</td></tr>`
        )
        .join("")}</table>`
    : `<p class="muted">No vendors in this workspace.</p>`;

  const topSpendSection = topSpend.length
    ? `<table><tr><th>Vendor</th><th>Category</th><th>YTD spend</th></tr>${topSpend
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.vendor.name)}</td><td>${escapeHtml(row.vendor.category)}</td><td>${escapeHtml(money(row.total))}</td></tr>`
        )
        .join("")}</table>`
    : `<p class="muted">No spend logged yet.</p>`;

  const vendorSections = vendors.length
    ? vendors
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(renderVendorBlock)
        .join("")
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(orgName)} — SupplierSync workspace report</title>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <p class="meta">${escapeHtml(orgName)} · Exported ${escapeHtml(exportedLabel)}</p>
  <h1>Workspace report</h1>
  <p class="lead">A readable summary of your clinic vendor records — contacts, contracts, documents, and spend. Open this file in any web browser. Use <strong>Print → Save as PDF</strong> to create a PDF copy.</p>

  <div class="stats">
    <div class="stat"><strong>${vendors.length}</strong><span>Vendors</span></div>
    <div class="stat"><strong>${totalContacts}</strong><span>Contacts</span></div>
    <div class="stat"><strong>${totalContracts}</strong><span>Contracts</span></div>
    <div class="stat"><strong>${totalDocuments}</strong><span>Documents</span></div>
    <div class="stat"><strong>${escapeHtml(money(ytdSpend))}</strong><span>YTD spend logged</span></div>
  </div>

  <h2>Vendor directory</h2>
  ${vendorDirectory}

  <h2>Top spend (YTD)</h2>
  ${topSpendSection}

  <h2>Vendor details</h2>
  ${vendorSections || `<p class="muted">No vendor records to display.</p>`}

  <p class="footer-note">Generated by SupplierSync. Uploaded PDF files are not included in this export — only file names, sizes, and metadata. For a machine-readable backup, use the advanced JSON export in Account settings.</p>
</body>
</html>`;
}

export function downloadOrganizationReport(data: OrganizationExport): void {
  let html: string;
  try {
    html = buildOrganizationExportHtml(data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Could not build workspace report: ${detail}`);
  }

  try {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    downloadBlob(blob, organizationReportFilename(data.organization.name, new Date(data.exportedAt)));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    throw new Error(
      `Could not start the report download: ${detail}. Check that downloads are allowed for this site and try again.`
    );
  }
}
