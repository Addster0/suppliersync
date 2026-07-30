import { requireSupabase } from "../lib/supabase";
import { formatStorageError, ORG_FILES_BUCKET } from "../lib/storage";
import type {
  Contact,
  Contract,
  DocumentItem,
  Evaluation,
  Experiment,
  LedgerEntry,
  RenewalItem,
  SearchResult,
  Status,
  Vendor,
} from "../types";
import { parseCriteria, type EvaluationRecommendation } from "../lib/evaluations";
import {
  RENEWAL_LOOKAHEAD_DAYS,
  RENEWAL_RECENT_EXPIRED_DAYS,
  daysUntilEnd,
  formatDateForQuery,
  getRenewalUrgency,
} from "../lib/renewals";
import { normalizeStorageFileUrl } from "../lib/utils";
import type { CsvVendorRow } from "../lib/csvImport";

type VendorRow = {
  id: string;
  organization_id: string;
  name: string;
  category: string;
  status: Status;
  notes: string;
  notes_locked: boolean;
  address: string;
  directory_id: string | null;
  created_at: string;
  contacts: Array<{
    id: string;
    name: string;
    role: string;
    email: string;
    phone: string;
  }> | null;
  contracts: Array<{
    id: string;
    title: string;
    start_date: string;
    end_date: string;
    value: number;
    status: Status;
    file_url: string | null;
    file_name: string | null;
    file_size: number | null;
    mime_type: string | null;
  }> | null;
  documents: Array<{
    id: string;
    title: string;
    file_url: string;
    file_size: number;
    doc_type: string;
    expires_at: string | null;
    created_at: string;
  }> | null;
  vendor_spend_snapshots: Array<{
    id: string;
    entry_date: string;
    description: string;
    amount: number;
    entry_type: LedgerEntry["type"];
    source: LedgerEntry["source"];
  }> | null;
  vendor_evaluations: Array<{
    id: string;
    eval_date: string;
    score: number;
    notes: string;
    criteria: Record<string, number> | null;
    recommendation: string | null;
    reviewer_name: string | null;
  }> | null;
  vendor_experiments: Array<{
    id: string;
    title: string;
    description: string;
    status: Experiment["status"];
  }> | null;
};

const vendorSelect = `
  id,
  organization_id,
  name,
  category,
  status,
  notes,
  notes_locked,
  address,
  directory_id,
  created_at,
  contacts (id, name, role, email, phone),
  contracts (
    id, title, start_date, end_date, value, status,
    file_url, file_name, file_size, mime_type
  ),
  documents (id, title, file_url, file_size, doc_type, expires_at, created_at),
  vendor_spend_snapshots (id, entry_date, description, amount, entry_type, source),
  vendor_evaluations (id, eval_date, score, notes, criteria, recommendation, reviewer_name),
  vendor_experiments (id, title, description, status)
`;

function mapVendor(row: VendorRow): Vendor {
  return {
    id: row.id,
    directoryId: row.directory_id ?? undefined,
    name: row.name,
    category: row.category,
    status: row.status,
    notes: row.notes,
    notesLocked: row.notes_locked ?? false,
    address: row.address ?? "",
    createdAt: row.created_at?.slice(0, 10),
    contacts: (row.contacts ?? []).map(
      (c): Contact => ({
        id: c.id,
        name: c.name,
        role: c.role,
        email: c.email,
        phone: c.phone,
      })
    ),
    contracts: (row.contracts ?? []).map(
      (c): Contract => ({
        id: c.id,
        name: c.title,
        startDate: c.start_date,
        endDate: c.end_date,
        value: Number(c.value),
        status: c.status,
        file:
          c.file_url && c.file_name
            ? {
                fileName: c.file_name,
                fileSize: c.file_size ?? 0,
                fileUrl: normalizeStorageFileUrl(c.file_url),
                mimeType: c.mime_type ?? "application/octet-stream",
              }
            : undefined,
      })
    ),
    ledger: (row.vendor_spend_snapshots ?? []).map(
      (entry): LedgerEntry => ({
        id: entry.id,
        date: entry.entry_date,
        description: entry.description,
        amount: Number(entry.amount),
        type: entry.entry_type,
        source: entry.source,
      })
    ),
    documents: (row.documents ?? []).map(
      (doc): DocumentItem => ({
        id: doc.id,
        fileName: doc.title,
        fileSize: doc.file_size,
        createdAt: doc.created_at.slice(0, 10),
        fileUrl: normalizeStorageFileUrl(doc.file_url),
        docType: (doc.doc_type as DocumentItem["docType"]) || "general",
        expiresAt: doc.expires_at?.slice(0, 10),
      })
    ),
    evaluations: (row.vendor_evaluations ?? []).map(
      (item): Evaluation => ({
        id: item.id,
        date: item.eval_date,
        score: item.score,
        criteria: parseCriteria(item.criteria),
        recommendation: (item.recommendation ?? "acceptable") as EvaluationRecommendation,
        reviewerName: item.reviewer_name ?? "",
        notes: item.notes,
      })
    ),
    experiments: (row.vendor_experiments ?? []).map(
      (item): Experiment => ({
        id: item.id,
        title: item.title,
        description: item.description,
        status: item.status,
      })
    ),
  };
}

export async function fetchVendors(organizationId: string): Promise<Vendor[]> {
  const { data, error } = await requireSupabase()
    .from("vendors")
    .select(vendorSelect)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as VendorRow[]).map(mapVendor);
}

export async function createVendor(
  organizationId: string,
  input: { name: string; category: string; notes?: string; address?: string; directoryId?: string }
): Promise<Vendor> {
  const { data, error } = await requireSupabase()
    .from("vendors")
    .insert({
      organization_id: organizationId,
      name: input.name,
      category: input.category,
      notes: input.notes ?? "",
      address: input.address ?? "",
      directory_id: input.directoryId ?? null,
      status: "pending",
    })
    .select(vendorSelect)
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not create vendor.");
  return mapVendor(data as VendorRow);
}

export async function updateVendorCore(
  vendorId: string,
  patch: Partial<Pick<Vendor, "name" | "category" | "status" | "notes" | "address" | "notesLocked">>
): Promise<void> {
  const { error } = await requireSupabase()
    .from("vendors")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.address !== undefined ? { address: patch.address } : {}),
      ...(patch.notesLocked !== undefined ? { notes_locked: patch.notesLocked } : {}),
    })
    .eq("id", vendorId);

  if (error) throw new Error(error.message);
}

export async function deleteVendor(vendorId: string): Promise<void> {
  const { error } = await requireSupabase().from("vendors").delete().eq("id", vendorId);
  if (error) throw new Error(error.message);
}

export async function addContact(organizationId: string, vendorId: string, contact: Omit<Contact, "id">) {
  const { error } = await requireSupabase().from("contacts").insert({
    organization_id: organizationId,
    vendor_id: vendorId,
    name: contact.name,
    role: contact.role,
    email: contact.email,
    phone: contact.phone,
  });
  if (error) throw new Error(error.message);
}

export async function deleteContact(contactId: string) {
  const { error } = await requireSupabase().from("contacts").delete().eq("id", contactId);
  if (error) throw new Error(error.message);
}

export async function addContract(
  organizationId: string,
  vendorId: string,
  contract: Omit<Contract, "id">
) {
  const { error } = await requireSupabase().from("contracts").insert({
    organization_id: organizationId,
    vendor_id: vendorId,
    title: contract.name,
    start_date: contract.startDate,
    end_date: contract.endDate,
    value: contract.value,
    status: contract.status,
    file_url: contract.file?.fileUrl ?? null,
    file_name: contract.file?.fileName ?? null,
    file_size: contract.file?.fileSize ?? null,
    mime_type: contract.file?.mimeType ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteContract(contractId: string) {
  const { error } = await requireSupabase().from("contracts").delete().eq("id", contractId);
  if (error) throw new Error(error.message);
}

export async function addLedgerEntry(
  organizationId: string,
  vendorId: string,
  entry: Omit<LedgerEntry, "id">
) {
  const { error } = await requireSupabase().from("vendor_spend_snapshots").insert({
    organization_id: organizationId,
    vendor_id: vendorId,
    entry_date: entry.date,
    description: entry.description,
    amount: entry.amount,
    entry_type: entry.type,
    source: entry.source ?? "manual",
  });
  if (error) throw new Error(error.message);
}

export async function deleteLedgerEntry(entryId: string) {
  const { error } = await requireSupabase().from("vendor_spend_snapshots").delete().eq("id", entryId);
  if (error) throw new Error(error.message);
}

export async function addDocument(
  organizationId: string,
  vendorId: string,
  document: Omit<DocumentItem, "id">
) {
  const { error } = await requireSupabase().from("documents").insert({
    organization_id: organizationId,
    vendor_id: vendorId,
    title: document.fileName,
    file_url: document.fileUrl,
    file_size: document.fileSize,
    doc_type: document.docType ?? "general",
    expires_at: document.expiresAt ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteDocument(documentId: string) {
  const { error } = await requireSupabase().from("documents").delete().eq("id", documentId);
  if (error) throw new Error(error.message);
}

export async function addEvaluation(
  organizationId: string,
  vendorId: string,
  evaluation: Omit<Evaluation, "id">
) {
  const { error } = await requireSupabase().from("vendor_evaluations").insert({
    organization_id: organizationId,
    vendor_id: vendorId,
    eval_date: evaluation.date,
    score: evaluation.score,
    criteria: evaluation.criteria,
    recommendation: evaluation.recommendation,
    reviewer_name: evaluation.reviewerName,
    notes: evaluation.notes,
  });
  if (error) throw new Error(error.message);
}

export async function deleteEvaluation(evaluationId: string) {
  const { error } = await requireSupabase().from("vendor_evaluations").delete().eq("id", evaluationId);
  if (error) throw new Error(error.message);
}

export async function addExperiment(
  organizationId: string,
  vendorId: string,
  experiment: Omit<Experiment, "id">
) {
  const { error } = await requireSupabase().from("vendor_experiments").insert({
    organization_id: organizationId,
    vendor_id: vendorId,
    title: experiment.title,
    description: experiment.description,
    status: experiment.status,
  });
  if (error) throw new Error(error.message);
}

export async function deleteExperiment(experimentId: string) {
  const { error } = await requireSupabase().from("vendor_experiments").delete().eq("id", experimentId);
  if (error) throw new Error(error.message);
}

export async function uploadOrgFile(
  organizationId: string,
  vendorId: string,
  file: File
): Promise<{ fileUrl: string; path: string }> {
  const client = requireSupabase();
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${organizationId}/${vendorId}/${Date.now()}-${safeName}`;

  const { error } = await client.storage.from(ORG_FILES_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });

  if (error) throw new Error(formatStorageError(error.message));

  return { fileUrl: `sb://${path}`, path };
}

export async function resolveStorageUrl(fileUrl: string): Promise<string> {
  const normalized = normalizeStorageFileUrl(fileUrl);
  if (!normalized.startsWith("sb://")) {
    return normalized;
  }

  const path = normalized.slice(5);
  const client = requireSupabase();

  const { data, error } = await client.storage.from(ORG_FILES_BUCKET).createSignedUrl(path, 60 * 60);

  if (!error && data?.signedUrl) {
    return data.signedUrl;
  }

  const { data: blob, error: downloadError } = await client.storage.from(ORG_FILES_BUCKET).download(path);

  if (downloadError || !blob) {
    const raw = downloadError?.message ?? error?.message ?? "Could not open file.";
    throw new Error(formatStorageError(raw));
  }

  return URL.createObjectURL(blob);
}

export async function openFileUrl(fileUrl: string): Promise<void> {
  const url = await resolveStorageUrl(fileUrl);
  const popup = window.open(url, "_blank");
  if (popup) {
    popup.opener = null;
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function searchOrganization(
  organizationId: string,
  query: string
): Promise<SearchResult[]> {
  const { data, error } = await requireSupabase().rpc("search_organization", {
    p_org_id: organizationId,
    p_query: query,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map(
    (row: {
      entity_type: string;
      entity_id: string;
      vendor_id: string;
      vendor_name: string;
      title: string;
      subtitle: string;
    }): SearchResult => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      vendorId: row.vendor_id,
      vendorName: row.vendor_name,
      title: row.title,
      subtitle: row.subtitle,
    })
  );
}

export async function importVendorsFromCsv(
  organizationId: string,
  rows: CsvVendorRow[]
): Promise<{
  imported: number;
  missingRenewalDates: number;
  missingContacts: number;
  withContracts: number;
}> {
  let imported = 0;
  const today = formatDateForQuery(new Date());

  for (const row of rows) {
    const vendor = await createVendor(organizationId, {
      name: row.name,
      category: row.category,
      address: row.address ?? "",
    });

    if (row.contactName || row.contactEmail || row.contactPhone) {
      await addContact(organizationId, vendor.id, {
        name: row.contactName || row.name,
        role: "",
        email: row.contactEmail || "",
        phone: row.contactPhone || "",
      });
    }

    if (row.contractName && row.contractEndDate) {
      await addContract(organizationId, vendor.id, {
        name: row.contractName,
        startDate: today,
        endDate: row.contractEndDate,
        value: row.contractValue ?? 0,
        status: "active",
      });
    }

    imported += 1;
  }

  const missingRenewalDates = rows.filter((row) => !row.contractEndDate).length;
  const missingContacts = rows.filter((row) => !row.contactEmail && !row.contactPhone).length;
  const withContracts = rows.filter((row) => row.contractName || row.contractEndDate).length;

  return { imported, missingRenewalDates, missingContacts, withContracts };
}

export async function seedSampleVendors(organizationId: string): Promise<void> {
  const soonEnd = formatDateForQuery(new Date(Date.now() + 18 * 24 * 60 * 60 * 1000));
  const overdueEnd = formatDateForQuery(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));

  const samples = [
    {
      name: "Northstar Supply Co.",
      category: "Equipment Supplier",
      status: "active" as Status,
      notes: "Reliable vendor for recurring equipment orders.",
      contacts: [
        {
          name: "Maya Thompson",
          role: "Account Manager",
          email: "maya@northstar.example",
          phone: "(555) 123-7821",
        },
      ],
      contracts: [
        {
          title: "2026 Annual Supply Agreement",
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          value: 48000,
          status: "active" as Status,
        },
      ],
      spend: [
        {
          entry_date: "2026-05-01",
          description: "May invoice payment",
          amount: 4000,
          entry_type: "payment",
        },
      ],
    },
    {
      name: "Brightline Services",
      category: "Maintenance",
      status: "pending" as Status,
      notes: "Waiting on signed contract and insurance document.",
      contracts: [
        {
          title: "HVAC & facilities service agreement",
          start_date: "2025-06-01",
          end_date: soonEnd,
          value: 18500,
          status: "active" as Status,
        },
        {
          title: "Emergency line maintenance (expired)",
          start_date: "2024-06-01",
          end_date: overdueEnd,
          value: 4200,
          status: "expired" as Status,
        },
      ],
    },
  ];

  const client = requireSupabase();

  for (const sample of samples) {
    const { data: vendor, error } = await client
      .from("vendors")
      .insert({
        organization_id: organizationId,
        name: sample.name,
        category: sample.category,
        status: sample.status,
        notes: sample.notes,
      })
      .select("id")
      .single();

    if (error || !vendor) throw new Error(error?.message ?? "Seed failed.");

    if (sample.contacts?.length) {
      await client.from("contacts").insert(
        sample.contacts.map((contact) => ({
          organization_id: organizationId,
          vendor_id: vendor.id,
          ...contact,
        }))
      );
    }

    if (sample.contracts?.length) {
      await client.from("contracts").insert(
        sample.contracts.map((contract) => ({
          organization_id: organizationId,
          vendor_id: vendor.id,
          ...contract,
        }))
      );
    }

    if (sample.spend?.length) {
      await client.from("vendor_spend_snapshots").insert(
        sample.spend.map((entry) => ({
          organization_id: organizationId,
          vendor_id: vendor.id,
          source: "manual",
          ...entry,
        }))
      );
    }
  }
}

export async function fetchUpcomingRenewals(organizationId: string): Promise<RenewalItem[]> {
  const client = requireSupabase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() - RENEWAL_RECENT_EXPIRED_DAYS);

  const rangeEnd = new Date(today);
  rangeEnd.setDate(rangeEnd.getDate() + RENEWAL_LOOKAHEAD_DAYS);

  const { data, error } = await client
    .from("contracts")
    .select(
      `
      id,
      title,
      end_date,
      value,
      status,
      vendor_id,
      file_url,
      file_name,
      file_size,
      vendors ( name )
    `
    )
    .eq("organization_id", organizationId)
    .gte("end_date", formatDateForQuery(rangeStart))
    .lte("end_date", formatDateForQuery(rangeEnd))
    .order("end_date", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((row) => {
    const vendor = row.vendors as { name: string } | { name: string }[] | null;
    const vendorName = Array.isArray(vendor) ? vendor[0]?.name : vendor?.name;
    if (!vendorName) return [];

    const days = daysUntilEnd(row.end_date);
    return [
      {
        contractId: row.id,
        contractName: row.title,
        vendorId: row.vendor_id,
        vendorName,
        endDate: row.end_date,
        value: Number(row.value),
        status: row.status as Status,
        daysUntilEnd: days,
        urgency: getRenewalUrgency(days),
        fileUrl:
          row.file_url && row.file_name ? normalizeStorageFileUrl(row.file_url) : undefined,
        fileName: row.file_name ?? undefined,
        fileSize: row.file_size ?? undefined,
      },
    ];
  });
}
