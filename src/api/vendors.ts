import { requireSupabase } from "../lib/supabase";
import { formatStorageError, ORG_FILES_BUCKET } from "../lib/storage";
import type {
  Contact,
  Contract,
  ContractRenewalType,
  DocumentItem,
  Evaluation,
  Experiment,
  FileAttachment,
  LedgerEntry,
  RenewalItem,
  SearchResult,
  Status,
  Vendor,
  VendorStickyNote,
} from "../types";
import { parseCriteria, type EvaluationRecommendation } from "../lib/evaluations";
import {
  RENEWAL_LOOKAHEAD_DAYS,
  RENEWAL_RECENT_EXPIRED_DAYS,
  daysUntilEnd,
  formatDateForQuery,
  getContractActionDate,
  getContractDateLabel,
  getRenewalUrgency,
} from "../lib/renewals";
import { isSampleVendor } from "../lib/sampleVendors";
import {
  assertAllowedUploadMime,
  assertValidStorageFileUrl,
  getStoragePathFromFileUrl,
  isDirectPreviewUrl,
  normalizeStorageFileUrl,
} from "../lib/utils";
import { MAX_VENDOR_IMPORT_ROWS } from "../lib/vendorImport";
import type { CsvVendorRow } from "../lib/csvImport";
import {
  removeOrgStorageFileFromUrl,
  removeOrgStoragePrefix,
} from "../lib/storageCleanup";

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
    end_date: string | null;
    renewal_date: string | null;
    renewal_type: ContractRenewalType;
    notice_period_days: number | null;
    term_months: number | null;
    value: number;
    status: Status;
    created_at: string;
    renewal_handled_at: string | null;
    renewal_handled_note: string | null;
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
  vendor_sticky_notes: Array<{
    id: string;
    body: string;
    created_at: string;
    updated_at: string;
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
    id, title, start_date, end_date, renewal_date, renewal_type,
    notice_period_days, term_months, value, status,
    created_at, renewal_handled_at, renewal_handled_note,
    file_url, file_name, file_size, mime_type
  ),
  documents (id, title, file_url, file_size, doc_type, expires_at, created_at),
  vendor_spend_snapshots (id, entry_date, description, amount, entry_type, source),
  vendor_evaluations (id, eval_date, score, notes, criteria, recommendation, reviewer_name),
  vendor_experiments (id, title, description, status)
`;

type ContractRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  renewal_date: string | null;
  renewal_type: ContractRenewalType;
  notice_period_days: number | null;
  term_months: number | null;
  value: number;
  status: Status;
  created_at?: string;
  renewal_handled_at?: string | null;
  renewal_handled_note?: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
};

function mapContractRow(row: ContractRow): Contract {
  return {
    id: row.id,
    name: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    renewalDate: row.renewal_date,
    renewalType: row.renewal_type ?? "fixed_term",
    noticePeriodDays: row.notice_period_days,
    termMonths: row.term_months,
    value: Number(row.value),
    status: row.status,
    createdAt: row.created_at?.slice(0, 10),
    renewalHandledAt: row.renewal_handled_at ?? null,
    renewalHandledNote: row.renewal_handled_note ?? null,
    file:
      row.file_url && row.file_name
        ? {
            fileName: row.file_name,
            fileSize: row.file_size ?? 0,
            fileUrl: normalizeStorageFileUrl(row.file_url),
            mimeType: row.mime_type ?? "application/octet-stream",
          }
        : undefined,
  };
}

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
    contracts: (row.contracts ?? []).map(mapContractRow),
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
    stickyNotes: (row.vendor_sticky_notes ?? [])
      .map(
        (note): VendorStickyNote => ({
          id: note.id,
          body: note.body,
          createdAt: note.created_at,
          updatedAt: note.updated_at,
        })
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

function stickyNoteSetupHintFromError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("vendor_sticky_notes") ||
    lower.includes("does not exist") ||
    lower.includes("schema cache") ||
    lower.includes("relationship")
  ) {
    return " Run supabase/migrations/034_vendor_sticky_notes.sql in Supabase SQL Editor, then refresh.";
  }
  return "";
}

function mapStickyNoteRow(note: {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
}): VendorStickyNote {
  return {
    id: note.id,
    body: note.body,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  };
}

async function fetchStickyNotesByVendor(
  organizationId: string
): Promise<Map<string, VendorStickyNote[]>> {
  const { data, error } = await requireSupabase()
    .from("vendor_sticky_notes")
    .select("id, vendor_id, body, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message + stickyNoteSetupHintFromError(error.message));
  }

  const byVendor = new Map<string, VendorStickyNote[]>();
  for (const row of data ?? []) {
    const note = mapStickyNoteRow(row);
    const list = byVendor.get(row.vendor_id) ?? [];
    list.push(note);
    byVendor.set(row.vendor_id, list);
  }
  return byVendor;
}

export async function fetchVendors(organizationId: string): Promise<Vendor[]> {
  const { data, error } = await requireSupabase()
    .from("vendors")
    .select(vendorSelect)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message + stickyNoteSetupHintFromError(error.message));
  }

  const vendors = (data as VendorRow[]).map(mapVendor);

  try {
    // Load notes separately — more reliable than PostgREST embeds for this table.
    const notesByVendor = await fetchStickyNotesByVendor(organizationId);
    return vendors.map((vendor) => ({
      ...vendor,
      stickyNotes: notesByVendor.get(vendor.id) ?? [],
    }));
  } catch (notesError) {
    // Keep vendors usable even if sticky-note table is not migrated yet.
    if (import.meta.env.DEV) {
      console.warn(notesError);
    }
    return vendors;
  }
}

export async function createVendorStickyNote(
  organizationId: string,
  vendorId: string,
  body = ""
): Promise<VendorStickyNote> {
  const { data, error } = await requireSupabase()
    .from("vendor_sticky_notes")
    .insert({
      organization_id: organizationId,
      vendor_id: vendorId,
      body: body.trim(),
    })
    .select("id, body, created_at, updated_at")
    .single();

  if (error || !data) {
    const message = error?.message ?? "Could not create note.";
    throw new Error(message + stickyNoteSetupHintFromError(message));
  }

  return mapStickyNoteRow(data);
}

export async function updateVendorStickyNote(noteId: string, body: string): Promise<VendorStickyNote> {
  const { data, error } = await requireSupabase()
    .from("vendor_sticky_notes")
    .update({ body: body.trim(), updated_at: new Date().toISOString() })
    .eq("id", noteId)
    .select("id, body, created_at, updated_at")
    .single();

  if (error || !data) {
    const message = error?.message ?? "Could not save note.";
    throw new Error(message + stickyNoteSetupHintFromError(message));
  }

  return mapStickyNoteRow(data);
}

export async function deleteVendorStickyNote(noteId: string): Promise<void> {
  const { error } = await requireSupabase().from("vendor_sticky_notes").delete().eq("id", noteId);
  if (error) throw new Error(error.message + stickyNoteSetupHintFromError(error.message));
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
  const client = requireSupabase();
  const { data: vendor } = await client
    .from("vendors")
    .select("organization_id")
    .eq("id", vendorId)
    .maybeSingle();

  if (vendor?.organization_id) {
    await removeOrgStoragePrefix(`${vendor.organization_id}/${vendorId}`);
  }

  const { error } = await client.from("vendors").delete().eq("id", vendorId);
  if (error) throw new Error(error.message);
}

export async function deleteSampleVendors(organizationId: string): Promise<number> {
  const vendors = await fetchVendors(organizationId);
  const samples = vendors.filter(isSampleVendor);
  for (const vendor of samples) {
    await deleteVendor(vendor.id);
  }
  return samples.length;
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
): Promise<Contract> {
  if (!organizationId.trim()) {
    throw new Error("No workspace selected. Refresh the page and try again.");
  }
  if (!vendorId.trim()) {
    throw new Error("No vendor selected. Pick a vendor and try again.");
  }

  const client = requireSupabase();
  const { data: vendor, error: vendorError } = await client
    .from("vendors")
    .select("id")
    .eq("id", vendorId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (vendorError) throw new Error(vendorError.message);
  if (!vendor) {
    throw new Error(
      "This vendor is not in the current workspace. Refresh the page, confirm the workspace at the top, and try again."
    );
  }

  const fileUrl = contract.file?.fileUrl ? assertValidStorageFileUrl(contract.file.fileUrl) : null;

  const { data, error } = await client
    .from("contracts")
    .insert({
      organization_id: organizationId,
      vendor_id: vendorId,
      title: contract.name,
      start_date: contract.startDate,
      end_date: contract.endDate,
      renewal_date: contract.renewalDate,
      renewal_type: contract.renewalType,
      notice_period_days: contract.noticePeriodDays,
      term_months: contract.termMonths,
      value: contract.value,
      status: contract.status,
      file_url: fileUrl,
      file_name: contract.file?.fileName ?? null,
      file_size: contract.file?.fileSize ?? null,
      mime_type: contract.file?.mimeType ?? null,
    })
    .select(
      "id, title, start_date, end_date, renewal_date, renewal_type, notice_period_days, term_months, value, status, created_at, renewal_handled_at, renewal_handled_note, file_url, file_name, file_size, mime_type"
    )
    .single();

  if (error) {
    if (/row-level security|permission denied|not authorized/i.test(error.message)) {
      throw new Error(
        "You don't have permission to save contracts in this workspace. Confirm you're signed in as an owner, admin, or member."
      );
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error("Contract save did not persist. Refresh and try again.");

  return mapContractRow(data as ContractRow);
}

export async function updateContract(
  contractId: string,
  contract: Omit<Contract, "id">
): Promise<Contract> {
  const { data, error } = await requireSupabase()
    .from("contracts")
    .update({
      title: contract.name,
      start_date: contract.startDate,
      end_date: contract.endDate,
      renewal_date: contract.renewalDate,
      renewal_type: contract.renewalType,
      notice_period_days: contract.noticePeriodDays,
      term_months: contract.termMonths,
      value: contract.value,
      status: contract.status,
    })
    .eq("id", contractId)
    .select(
      "id, title, start_date, end_date, renewal_date, renewal_type, notice_period_days, term_months, value, status, created_at, renewal_handled_at, renewal_handled_note, file_url, file_name, file_size, mime_type"
    )
    .single();

  if (error) {
    if (/row-level security|permission denied|not authorized/i.test(error.message)) {
      throw new Error(
        "You don't have permission to edit contracts in this workspace. Confirm you're signed in as an owner, admin, or member."
      );
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error("Contract update did not persist. Refresh and try again.");

  return mapContractRow(data as ContractRow);
}

const CONTRACT_ROW_SELECT =
  "id, title, start_date, end_date, renewal_date, renewal_type, notice_period_days, term_months, value, status, created_at, renewal_handled_at, renewal_handled_note, file_url, file_name, file_size, mime_type";

export async function attachFileToContract(
  contractId: string,
  file: FileAttachment
): Promise<Contract> {
  if (!contractId.trim()) {
    throw new Error("No contract selected. Refresh and try again.");
  }

  const fileUrl = assertValidStorageFileUrl(file.fileUrl);
  const client = requireSupabase();
  const { data: existing, error: existingError } = await client
    .from("contracts")
    .select("file_url")
    .eq("id", contractId)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("Contract not found. Refresh and try again.");

  const previousFileUrl = existing.file_url as string | null;

  const { data, error } = await client
    .from("contracts")
    .update({
      file_url: fileUrl,
      file_name: file.fileName,
      file_size: file.fileSize,
      mime_type: file.mimeType,
    })
    .eq("id", contractId)
    .select(CONTRACT_ROW_SELECT)
    .single();

  if (error) {
    if (/row-level security|permission denied|not authorized/i.test(error.message)) {
      throw new Error(
        "You don't have permission to edit contracts in this workspace. Confirm you're signed in as an owner, admin, or member."
      );
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error("Contract file update did not persist. Refresh and try again.");

  if (previousFileUrl && previousFileUrl !== fileUrl) {
    await removeOrgStorageFileFromUrl(previousFileUrl);
  }

  return mapContractRow(data as ContractRow);
}

export async function uploadAndAttachContractFile(
  organizationId: string,
  vendorId: string,
  contractId: string,
  file: File
): Promise<Contract> {
  const uploaded = await uploadOrgFile(organizationId, vendorId, file);
  try {
    return await attachFileToContract(contractId, {
      fileName: file.name,
      fileSize: file.size,
      fileUrl: uploaded.fileUrl,
      mimeType: file.type || "application/octet-stream",
    });
  } catch (error) {
    await removeOrgFile(uploaded.path);
    throw error;
  }
}

/** Upload a PDF/file as a vendor contract attachment — attach to a file-less contract when possible. */
export async function uploadSetupContractDocument(
  organizationId: string,
  vendorId: string,
  file: File,
  contracts: Contract[]
): Promise<Contract> {
  const fileLess = contracts.find((contract) => !contract.file);
  if (fileLess) {
    return uploadAndAttachContractFile(organizationId, vendorId, fileLess.id, file);
  }

  const uploaded = await uploadOrgFile(organizationId, vendorId, file);
  try {
    const baseName = file.name.replace(/\.[^.]+$/, "").trim() || "Uploaded contract";
    return await addContract(organizationId, vendorId, {
      name: baseName,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: null,
      renewalDate: null,
      renewalType: "fixed_term",
      noticePeriodDays: null,
      termMonths: null,
      value: 0,
      status: "active",
      file: {
        fileName: file.name,
        fileSize: file.size,
        fileUrl: uploaded.fileUrl,
        mimeType: file.type || "application/octet-stream",
      },
    });
  } catch (error) {
    await removeOrgFile(uploaded.path);
    throw error;
  }
}

export async function deleteContract(contractId: string) {
  const client = requireSupabase();
  const { data: contract } = await client
    .from("contracts")
    .select("file_url")
    .eq("id", contractId)
    .maybeSingle();

  await removeOrgStorageFileFromUrl(contract?.file_url);

  const { error } = await client.from("contracts").delete().eq("id", contractId);
  if (error) throw new Error(error.message);
}

export async function setRenewalHandled(
  contractId: string,
  handled: boolean,
  note?: string
): Promise<Contract> {
  const { data, error } = await requireSupabase()
    .from("contracts")
    .update({
      renewal_handled_at: handled ? new Date().toISOString() : null,
      renewal_handled_note: handled ? note?.trim() || null : null,
    })
    .eq("id", contractId)
    .select(
      "id, title, start_date, end_date, renewal_date, renewal_type, notice_period_days, term_months, value, status, created_at, renewal_handled_at, renewal_handled_note, file_url, file_name, file_size, mime_type"
    )
    .single();

  if (error) {
    if (/row-level security|permission denied|not authorized/i.test(error.message)) {
      throw new Error("You don't have permission to update renewals in this workspace.");
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error("Renewal update did not persist. Refresh and try again.");

  return mapContractRow(data as ContractRow);
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
): Promise<DocumentItem> {
  const fileUrl = assertValidStorageFileUrl(document.fileUrl);

  const { data, error } = await requireSupabase()
    .from("documents")
    .insert({
      organization_id: organizationId,
      vendor_id: vendorId,
      title: document.fileName,
      file_url: fileUrl,
      file_size: document.fileSize,
      doc_type: document.docType ?? "general",
      expires_at: document.expiresAt ?? null,
    })
    .select("id, title, file_url, file_size, doc_type, expires_at, created_at")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not save document record.");

  return {
    id: data.id,
    fileName: data.title,
    fileSize: data.file_size,
    createdAt: data.created_at.slice(0, 10),
    fileUrl: normalizeStorageFileUrl(data.file_url),
    docType: (data.doc_type as DocumentItem["docType"]) || "general",
    expiresAt: data.expires_at?.slice(0, 10),
  };
}

export async function deleteDocument(documentId: string) {
  const client = requireSupabase();
  const { data: document } = await client
    .from("documents")
    .select("file_url")
    .eq("id", documentId)
    .maybeSingle();

  await removeOrgStorageFileFromUrl(document?.file_url);

  const { error } = await client.from("documents").delete().eq("id", documentId);
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
  assertAllowedUploadMime(file);
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

async function removeOrgFile(path: string) {
  const { error } = await requireSupabase().storage.from(ORG_FILES_BUCKET).remove([path]);
  if (error) {
    console.warn("Could not remove uploaded file after save failed:", error.message);
  }
}

export async function rollbackOrgUpload(path: string) {
  await removeOrgFile(path);
}

export async function uploadAndAddDocument(
  organizationId: string,
  vendorId: string,
  file: File,
  document: Omit<DocumentItem, "id" | "fileName" | "fileSize" | "fileUrl" | "createdAt">
): Promise<DocumentItem> {
  const uploaded = await uploadOrgFile(organizationId, vendorId, file);
  try {
    return await addDocument(organizationId, vendorId, {
      fileName: file.name,
      fileSize: file.size,
      createdAt: new Date().toISOString().slice(0, 10),
      fileUrl: uploaded.fileUrl,
      ...document,
    });
  } catch (error) {
    await removeOrgFile(uploaded.path);
    throw error;
  }
}

export async function resolveStorageUrl(fileUrl: string): Promise<string> {
  const normalized = normalizeStorageFileUrl(fileUrl);
  if (!normalized.startsWith("sb://")) {
    if (isDirectPreviewUrl(normalized)) {
      return normalized;
    }
    throw new Error("File URL must be an internal storage path (sb://).");
  }

  const path = getStoragePathFromFileUrl(normalized);
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
  if (rows.length > MAX_VENDOR_IMPORT_ROWS) {
    throw new Error(`Import is limited to ${MAX_VENDOR_IMPORT_ROWS} vendors per file.`);
  }

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
        renewalDate: null,
        renewalType: "fixed_term",
        noticePeriodDays: null,
        termMonths: null,
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

function mapRenewalRow(row: {
  id: string;
  title: string;
  end_date: string | null;
  renewal_date: string | null;
  renewal_type: ContractRenewalType;
  notice_period_days: number | null;
  value: number;
  status: string;
  vendor_id: string;
  renewal_handled_at?: string | null;
  renewal_handled_note?: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  vendors: { name: string } | { name: string }[] | null;
}): RenewalItem | null {
  const vendor = row.vendors;
  const vendorName = Array.isArray(vendor) ? vendor[0]?.name : vendor?.name;
  if (!vendorName) return null;

  const renewalType = (row.renewal_type ?? "fixed_term") as ContractRenewalType;
  const actionDate = getContractActionDate({
    renewalType,
    endDate: row.end_date,
    renewalDate: row.renewal_date,
    noticePeriodDays: row.notice_period_days,
  });

  if (!actionDate) return null;

  const days = daysUntilEnd(actionDate);
  return {
    contractId: row.id,
    contractName: row.title,
    vendorId: row.vendor_id,
    vendorName,
    actionDate,
    dateLabel: getContractDateLabel(renewalType),
    renewalType,
    endDate: actionDate,
    value: Number(row.value),
    status: row.status as Status,
    daysUntilEnd: days,
    urgency: getRenewalUrgency(days),
    renewalHandledAt: row.renewal_handled_at ?? null,
    renewalHandledNote: row.renewal_handled_note ?? null,
    fileUrl: row.file_url && row.file_name ? normalizeStorageFileUrl(row.file_url) : undefined,
    fileName: row.file_name ?? undefined,
    fileSize: row.file_size ?? undefined,
  };
}

const renewalSelect = `
  id,
  title,
  start_date,
  end_date,
  renewal_date,
  renewal_type,
  notice_period_days,
  term_months,
  value,
  status,
  vendor_id,
  renewal_handled_at,
  renewal_handled_note,
  file_url,
  file_name,
  file_size,
  vendors ( name )
`;

export async function fetchUpcomingRenewals(organizationId: string): Promise<RenewalItem[]> {
  const client = requireSupabase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() - RENEWAL_RECENT_EXPIRED_DAYS);

  const rangeEnd = new Date(today);
  rangeEnd.setDate(rangeEnd.getDate() + RENEWAL_LOOKAHEAD_DAYS);

  const startIso = formatDateForQuery(rangeStart);
  const endIso = formatDateForQuery(rangeEnd);

  // Fetch all unhandled contracts; filter by getContractActionDate in JS so auto-renew
  // notice deadlines are included even when end_date falls outside the window.
  const { data, error } = await client
    .from("contracts")
    .select(renewalSelect)
    .eq("organization_id", organizationId)
    .is("renewal_handled_at", null)
    .order("end_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);

  const items: RenewalItem[] = [];

  for (const row of data ?? []) {
    const item = mapRenewalRow(row);
    if (!item || item.actionDate < startIso || item.actionDate > endIso) continue;
    items.push(item);
  }

  return items.sort((a, b) => a.actionDate.localeCompare(b.actionDate));
}

export async function fetchHandledRenewals(organizationId: string): Promise<RenewalItem[]> {
  const { data, error } = await requireSupabase()
    .from("contracts")
    .select(renewalSelect)
    .eq("organization_id", organizationId)
    .not("renewal_handled_at", "is", null)
    .order("renewal_handled_at", { ascending: false });

  if (error) throw new Error(error.message);

  const items: RenewalItem[] = [];
  for (const row of data ?? []) {
    const item = mapRenewalRow(row);
    if (item) items.push(item);
  }
  return items;
}
