import type { Vendor } from "../types";

export type SetupStepId = "workspace" | "vendors" | "renewal" | "contact" | "document";

export type SetupStep = {
  id: SetupStepId;
  label: string;
  description: string;
  done: boolean;
  optional?: boolean;
  href?: string;
};

export function buildSetupSteps(
  workspaceName: string | undefined,
  vendors: Vendor[],
  documentSkipped: boolean
): SetupStep[] {
  const hasWorkspace = Boolean(workspaceName?.trim());
  const hasVendor = vendors.length > 0;
  const hasRenewal = vendors.some((vendor) =>
    vendor.contracts.some((contract) => Boolean(contract.endDate))
  );
  const hasContact = vendors.some((vendor) => vendor.contacts.length > 0);
  const hasDocument = vendors.some((vendor) => vendor.documents.length > 0);
  const firstVendorId = vendors[0]?.id ?? "";

  return [
    {
      id: "workspace",
      label: "Confirm your clinic workspace",
      description: "Your workspace keeps vendor data isolated and secure.",
      done: hasWorkspace,
      href: "/app/account",
    },
    {
      id: "vendors",
      label: "Add your critical vendors",
      description: "Import a CSV (fastest) or pick a vendor type and add one at a time.",
      done: hasVendor,
      href: "/app",
    },
    {
      id: "renewal",
      label: "Add a contract renewal date",
      description: "This is where SupplierSync proves its value — you'll never miss a deadline.",
      done: hasRenewal,
      href: firstVendorId ? `/app?vendor=${firstVendorId}&tab=contracts` : "/app",
    },
    {
      id: "contact",
      label: "Add a vendor contact",
      description: "Phone or email for when you need them before a renewal window closes.",
      done: hasContact,
      href: firstVendorId ? `/app?vendor=${firstVendorId}&tab=contacts` : "/app",
    },
    {
      id: "document",
      label: "Upload a compliance document",
      description: "COI, W-9, or a contract PDF — optional, but recommended for compliance tracking.",
      done: hasDocument || documentSkipped,
      optional: true,
      href: firstVendorId ? `/app?vendor=${firstVendorId}&tab=documents` : "/app",
    },
  ];
}

export function countCompletedSetupSteps(steps: SetupStep[]) {
  return steps.filter((step) => step.done).length;
}

export function isSetupComplete(steps: SetupStep[]) {
  return steps.every((step) => step.done);
}

export function firstIncompleteSetupStep(steps: SetupStep[]) {
  return steps.find((step) => !step.done) ?? null;
}

export function documentSkippedKey(organizationId: string) {
  return `setup-document-skipped-${organizationId}`;
}
