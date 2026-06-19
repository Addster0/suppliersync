import { formatDaysUntil, daysUntilEnd } from "./renewals";
import { ledgerPaymentTotal, vendorNetLedgerBalance, vendorYtdSpend } from "./spend";
import { complianceLabel } from "./attention";
import type { Vendor } from "../types";
import { money, prettyDate, openPrintableHtml } from "./utils";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nextRenewal(vendor: Vendor) {
  const upcoming = vendor.contracts
    .filter((contract) => contract.endDate)
    .map((contract) => ({ contract, days: daysUntilEnd(contract.endDate) }))
    .sort((a, b) => a.days - b.days);
  return upcoming[0];
}

export function openVendorOnePager(vendor: Vendor, workspaceName: string) {
  const primaryContact = vendor.contacts[0];
  const renewal = nextRenewal(vendor);
  const latestEvaluation = [...vendor.evaluations].sort((a, b) => b.date.localeCompare(a.date))[0];
  const ytdSpend = vendorYtdSpend(vendor);
  const netBalance = vendorNetLedgerBalance(vendor.ledger);
  const totalPayments = ledgerPaymentTotal(vendor.ledger);
  const generated = new Date().toLocaleString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(vendor.name)} — Vendor summary</title>
  <style>
    body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #172033; margin: 32px; line-height: 1.5; }
    h1 { font-size: 28px; margin: 0 0 4px; }
    .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; margin: 24px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
    th { color: #64748b; font-weight: 700; width: 34%; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 700; }
    .muted { color: #64748b; }
    ul { margin: 0; padding-left: 18px; }
    @media print { body { margin: 18px; } }
  </style>
</head>
<body>
  <p class="meta">${escapeHtml(workspaceName)} · Generated ${escapeHtml(generated)}</p>
  <h1>${escapeHtml(vendor.name)}</h1>
  <p class="muted">${escapeHtml(vendor.category)} · <span class="pill">${escapeHtml(vendor.status)}</span></p>

  <h2>At a glance</h2>
  <table>
    <tr><th>Primary contact</th><td>${primaryContact ? `${escapeHtml(primaryContact.name)}${primaryContact.role ? ` · ${escapeHtml(primaryContact.role)}` : ""}<br>${escapeHtml(primaryContact.email || "—")}${primaryContact.phone ? `<br>${escapeHtml(primaryContact.phone)}` : ""}` : "None on file"}</td></tr>
    <tr><th>Address</th><td>${vendor.address ? escapeHtml(vendor.address) : "—"}</td></tr>
    <tr><th>Next renewal</th><td>${renewal ? `${escapeHtml(renewal.contract.name)} · ends ${escapeHtml(prettyDate(renewal.contract.endDate))} (${escapeHtml(formatDaysUntil(renewal.days))})` : "No contracts with end dates"}</td></tr>
    <tr><th>YTD spend logged</th><td>${escapeHtml(money(ytdSpend))}</td></tr>
    <tr><th>Net spend balance</th><td>${escapeHtml(money(netBalance))} <span class="muted">(${escapeHtml(money(totalPayments))} in payments)</span></td></tr>
    <tr><th>Notes</th><td>${vendor.notes ? escapeHtml(vendor.notes) : "—"}</td></tr>
  </table>

  <h2>Contacts (${vendor.contacts.length})</h2>
  ${
    vendor.contacts.length
      ? `<table><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th></tr>${vendor.contacts
          .map(
            (contact) =>
              `<tr><td>${escapeHtml(contact.name)}</td><td>${escapeHtml(contact.role || "—")}</td><td>${escapeHtml(contact.email || "—")}</td><td>${escapeHtml(contact.phone || "—")}</td></tr>`
          )
          .join("")}</table>`
      : `<p class="muted">No contacts listed.</p>`
  }

  <h2>Contracts (${vendor.contracts.length})</h2>
  ${
    vendor.contracts.length
      ? `<table><tr><th>Contract</th><th>Dates</th><th>Value</th><th>Status</th></tr>${vendor.contracts
          .map(
            (contract) =>
              `<tr><td>${escapeHtml(contract.name)}${contract.file ? `<br><span class="muted">📎 ${escapeHtml(contract.file.fileName)}</span>` : ""}</td><td>${escapeHtml(prettyDate(contract.startDate))} – ${escapeHtml(prettyDate(contract.endDate))}</td><td>${escapeHtml(money(contract.value))}</td><td>${escapeHtml(contract.status)}</td></tr>`
          )
          .join("")}</table>`
      : `<p class="muted">No contracts on file.</p>`
  }

  <h2>Documents (${vendor.documents.length})</h2>
  ${
    vendor.documents.length
      ? `<ul>${vendor.documents
          .map((doc) => {
            const expiry = doc.expiresAt ? ` · expires ${escapeHtml(prettyDate(doc.expiresAt))}` : "";
            return `<li>${escapeHtml(doc.fileName)} · ${escapeHtml(complianceLabel(doc.docType))}${expiry}</li>`;
          })
          .join("")}</ul>`
      : `<p class="muted">No documents uploaded.</p>`
  }

  <h2>Recent spend</h2>
  ${
    vendor.ledger.length
      ? `<table><tr><th>Date</th><th>Description</th><th>Amount</th><th>Type</th></tr>${vendor.ledger
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 8)
          .map(
            (entry) =>
              `<tr><td>${escapeHtml(prettyDate(entry.date))}</td><td>${escapeHtml(entry.description)}</td><td>${escapeHtml(money(entry.amount))}</td><td>${escapeHtml(entry.type)}</td></tr>`
          )
          .join("")}</table>`
      : `<p class="muted">No spend entries logged.</p>`
  }

  ${
    latestEvaluation
      ? `<h2>Latest scorecard</h2>
  <table>
    <tr><th>Date</th><td>${escapeHtml(prettyDate(latestEvaluation.date))}</td></tr>
    <tr><th>Score</th><td>${latestEvaluation.score}/100 · ${escapeHtml(latestEvaluation.recommendation.replace(/_/g, " "))}</td></tr>
    <tr><th>Reviewer</th><td>${escapeHtml(latestEvaluation.reviewerName || "—")}</td></tr>
    <tr><th>Notes</th><td>${latestEvaluation.notes ? escapeHtml(latestEvaluation.notes) : "—"}</td></tr>
  </table>`
      : ""
  }
</body>
</html>`;

  openPrintableHtml(html);
}
