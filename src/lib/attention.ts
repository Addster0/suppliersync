import { daysUntilEnd, getContractUrgencyDate, getRenewalUrgency, isContractOverdue } from "./renewals";
import { vendorYtdSpend } from "./spend";
import type { DocumentItem, RenewalItem, Vendor } from "../types";

export type AttentionSeverity = "critical" | "warning" | "info";

export type AttentionItem = {
  id: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href?: string;
  actionLabel?: string;
};

export const COMPLIANCE_DOC_TYPES = [
  { value: "coi", label: "Certificate of insurance (COI)" },
  { value: "w9", label: "W-9 / tax form" },
  { value: "license", label: "Business license" },
  { value: "general", label: "General document" },
] as const;

export type ComplianceDocType = (typeof COMPLIANCE_DOC_TYPES)[number]["value"];

const REQUIRED_COMPLIANCE: ComplianceDocType[] = ["coi", "w9"];

export function complianceLabel(docType: string) {
  return COMPLIANCE_DOC_TYPES.find((item) => item.value === docType)?.label ?? docType;
}

function vendorHasDocType(documents: DocumentItem[], docType: ComplianceDocType) {
  return documents.some((doc) => doc.docType === docType);
}

function expiredComplianceDocs(vendor: Vendor) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return vendor.documents.filter((doc) => {
    if (!doc.expiresAt || doc.docType === "general") return false;
    const expiry = new Date(`${doc.expiresAt}T00:00:00`);
    return expiry < today;
  });
}

export function buildAttentionItems(vendors: Vendor[], renewals: RenewalItem[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  const listedContractIds = new Set(renewals.map((item) => item.contractId));

  for (const renewal of renewals) {
    if (renewal.urgency === "overdue" || renewal.urgency === "soon") {
      items.push({
        id: `renewal-${renewal.contractId}`,
        severity: renewal.urgency === "overdue" ? "critical" : "warning",
        title: renewal.urgency === "overdue" ? "Contract overdue" : "Renewal due soon",
        detail: `${renewal.contractName} · ${renewal.vendorName} · ${renewal.actionDate}`,
        href: `/app?vendor=${renewal.vendorId}&tab=contracts`,
        actionLabel: "View contract",
      });
    }
  }

  for (const vendor of vendors) {
    if (vendor.status === "inactive") continue;

    if (vendor.status === "active" && vendor.contacts.length === 0) {
      items.push({
        id: `contact-${vendor.id}`,
        severity: "warning",
        title: "No contact on file",
        detail: `${vendor.name} — add a phone or email before you need them.`,
        href: `/app?vendor=${vendor.id}&tab=contacts`,
        actionLabel: "Add contact",
      });
    }

    if (vendor.status === "active") {
      for (const docType of REQUIRED_COMPLIANCE) {
        if (!vendorHasDocType(vendor.documents, docType)) {
          items.push({
            id: `missing-${docType}-${vendor.id}`,
            severity: "info",
            title: `Missing ${complianceLabel(docType)}`,
            detail: `${vendor.name} — upload to Documents for compliance tracking.`,
            href: `/app?vendor=${vendor.id}&tab=documents`,
            actionLabel: "Upload document",
          });
        }
      }

      for (const doc of expiredComplianceDocs(vendor)) {
        items.push({
          id: `expired-doc-${doc.id}`,
          severity: "critical",
          title: "Compliance document expired",
          detail: `${vendor.name} · ${complianceLabel(doc.docType)} expired ${doc.expiresAt}`,
          href: `/app?vendor=${vendor.id}&tab=documents`,
          actionLabel: "Update document",
        });
      }
    }

    for (const contract of vendor.contracts) {
      if (contract.renewalHandledAt || contract.status === "inactive") continue;
      if (listedContractIds.has(contract.id)) continue;

      const urgencyDate = getContractUrgencyDate(contract);

      if (isContractOverdue(contract)) {
        items.push({
          id: `contract-overdue-${contract.id}`,
          severity: "critical",
          title: "Contract overdue",
          detail: `${contract.name} · ${vendor.name}${urgencyDate ? ` · ${urgencyDate}` : ""}`,
          href: `/app?vendor=${vendor.id}&tab=contracts`,
          actionLabel: "View contract",
        });
        continue;
      }

      if (!urgencyDate) continue;
      const days = daysUntilEnd(urgencyDate);
      if (!Number.isFinite(days)) continue;
      const urgency = getRenewalUrgency(days);
      if (urgency === "soon" || (urgency === "upcoming" && days <= 60)) {
        items.push({
          id: `contract-soon-${contract.id}`,
          severity: urgency === "soon" ? "warning" : "info",
          title: urgency === "soon" ? "Renewal due soon" : "Upcoming contract review",
          detail: `${contract.name} · ${vendor.name} · ${urgencyDate}`,
          href: `/app?vendor=${vendor.id}&tab=contracts`,
          actionLabel: "Review contract",
        });
      }
    }
  }

  const severityOrder: Record<AttentionSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export type OnboardingStep = {
  id: string;
  label: string;
  done: boolean;
  href: string;
};

export function buildOnboardingSteps(vendors: Vendor[]): OnboardingStep[] {
  const hasVendor = vendors.length > 0;
  const hasContract = vendors.some((vendor) => vendor.contracts.length > 0);
  const hasContractFile = vendors.some((vendor) =>
    vendor.contracts.some((contract) => Boolean(contract.file))
  );
  const hasDocument =
    vendors.some((vendor) => vendor.documents.length > 0) || hasContractFile;
  const hasSpend = vendors.some((vendor) => vendor.ledger.length > 0);
  const firstVendorId = vendors[0]?.id ?? "";

  return [
    {
      id: "vendor",
      label: "Add your first vendor",
      done: hasVendor,
      href: "/app",
    },
    {
      id: "contract",
      label: "Add a contract with an end date",
      done: hasContract,
      href: firstVendorId ? `/app?vendor=${firstVendorId}&tab=contracts` : "/app",
    },
    {
      id: "document",
      label: "Upload a compliance or contract document",
      done: hasDocument,
      href: firstVendorId
        ? `/app?vendor=${firstVendorId}&tab=${hasContractFile ? "contracts" : "documents"}`
        : "/app",
    },
    {
      id: "spend",
      label: "Log a spend entry",
      done: hasSpend,
      href: firstVendorId ? `/app?vendor=${firstVendorId}&tab=spend` : "/app",
    },
  ];
}

export function isOnboardingComplete(steps: OnboardingStep[]) {
  return steps.every((step) => step.done);
}

export function workspaceSpendSummary(vendors: Vendor[]) {
  const ytd = vendors.reduce((sum, vendor) => sum + vendorYtdSpend(vendor), 0);
  /** Vendors with at least one contract on file (renewals / contract tracking). */
  const trackedVendors = vendors.filter((vendor) => vendor.contracts.length > 0).length;
  const vendorsWithSpend = vendors.filter((vendor) => vendor.ledger.length > 0).length;
  return { ytd, trackedVendors, vendorsWithSpend, vendorCount: vendors.length };
}
