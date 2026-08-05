import { fetchVendors } from "./vendors";
import { downloadBlob } from "../lib/utils";
import { requireSupabase } from "../lib/supabase";
import type { Contract, DocumentItem, Vendor } from "../types";

export type OrganizationExport = {
  exportedAt: string;
  formatVersion: 1;
  organization: {
    id: string;
    name: string;
  };
  vendors: OrganizationExportVendor[];
};

type OrganizationExportVendor = Omit<Vendor, "contracts" | "documents"> & {
  contracts: OrganizationExportContract[];
  documents: OrganizationExportDocument[];
};

type OrganizationExportContract = Omit<Contract, "file"> & {
  file?: {
    fileName: string;
    fileSize: number;
    mimeType: string;
  };
};

type OrganizationExportDocument = Omit<DocumentItem, "fileUrl">;

function stripContractFile(contract: Contract): OrganizationExportContract {
  const { file, ...rest } = contract;
  if (!file) return rest;
  return {
    ...rest,
    file: {
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
    },
  };
}

function stripDocument(document: DocumentItem): OrganizationExportDocument {
  const { fileUrl: _fileUrl, ...rest } = document;
  return rest;
}

function sanitizeVendor(vendor: Vendor): OrganizationExportVendor {
  return {
    ...vendor,
    contracts: vendor.contracts.map(stripContractFile),
    documents: vendor.documents.map(stripDocument),
  };
}

export async function exportOrganizationData(organizationId: string): Promise<OrganizationExport> {
  const client = requireSupabase();

  const [{ data: org, error: orgError }, vendors] = await Promise.all([
    client.from("organizations").select("id, name").eq("id", organizationId).maybeSingle(),
    fetchVendors(organizationId),
  ]);

  if (orgError) throw new Error(orgError.message);
  if (!org) throw new Error("Workspace not found.");

  return {
    exportedAt: new Date().toISOString(),
    formatVersion: 1,
    organization: {
      id: org.id,
      name: org.name,
    },
    vendors: vendors.map(sanitizeVendor),
  };
}

function jsonExportFilename(orgName: string): string {
  const slug = orgName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const date = new Date().toISOString().slice(0, 10);
  return `suppliersync-export-${slug || "workspace"}-${date}.json`;
}

export function downloadOrganizationExport(data: OrganizationExport): void {
  try {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    downloadBlob(blob, jsonExportFilename(data.organization.name));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    throw new Error(
      `Could not start the JSON export download: ${detail}. Check that downloads are allowed for this site and try again.`
    );
  }
}
