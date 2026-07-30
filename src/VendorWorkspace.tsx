import { DragEvent, FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  addContact,
  addContract,
  addDocument,
  addLedgerEntry,
  createVendor,
  deleteContact,
  deleteContract,
  deleteDocument,
  deleteLedgerEntry,
  deleteVendor,
  fetchVendors,
  seedSampleVendors,
  updateVendorCore,
  uploadOrgFile,
} from "./api/vendors";
import { BrandLogo } from "./components/BrandLogo";
import { DocumentViewerModal } from "./components/DocumentViewerModal";
import { EvaluationsSection } from "./components/EvaluationsSection";
import { FileAttachmentLink } from "./components/FileAttachmentLink";
import { GlobalSearch } from "./components/GlobalSearch";
import { VendorImportPanel } from "./components/VendorImportPanel";
import { VendorAddressField } from "./components/VendorAddressField";
import { VendorNotesEditor } from "./components/VendorNotesEditor";
import { VendorTemplatePicker } from "./components/VendorTemplatePicker";
import { RenewalsSummary } from "./pages/RenewalsPage";
import { useAuth } from "./contexts/AuthContext";
import { useOrganization } from "./contexts/OrganizationContext";
import { useSetup } from "./contexts/SetupContext";
import { COMPLIANCE_DOC_TYPES, complianceLabel } from "./lib/attention";
import { filterAndRankVendors } from "./lib/search";
import {
  DEFAULT_VENDOR_SORT,
  VENDOR_SORT_OPTIONS,
  loadVendorSort,
  saveVendorSort,
  sortVendors,
  type VendorSortKey,
} from "./lib/vendorSort";
import { openVendorOnePager } from "./lib/vendorOnePager";
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_BYTES,
  formatFileSize,
  getStatusClass,
  hasDownloadableFile,
  localFileToAttachment,
  money,
  prettyDate,
  revokeAttachmentUrl,
} from "./lib/utils";
import {
  CONTRACT_END_HINT,
  CONTRACT_END_LABEL,
  CONTRACT_START_HINT,
  CONTRACT_START_LABEL,
} from "./lib/renewals";
import type { Contract, DocumentDocType, DocumentItem, FileAttachment, LedgerEntry, Status, Vendor } from "./types";

const tabs = ["contacts", "contracts", "spend", "documents", "evaluations"] as const;
type Tab = (typeof tabs)[number];

async function fileToStorageAttachment(
  organizationId: string,
  vendorId: string,
  file: File
): Promise<FileAttachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatFileSize(file.size)}. Maximum ${formatFileSize(MAX_FILE_BYTES)} per file.`
    );
  }
  const uploaded = await uploadOrgFile(organizationId, vendorId, file);
  return {
    fileName: file.name,
    fileSize: file.size,
    fileUrl: uploaded.fileUrl,
    mimeType: file.type || "application/octet-stream",
  };
}

export function VendorWorkspace() {
  const { user } = useAuth();
  const { activeMembership, memberships, canWrite, setActiveOrganizationId } = useOrganization();
  const organizationId = activeMembership?.organizationId ?? "";
  const sidebarImportInputId = useId();
  const [searchParams] = useSearchParams();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<Tab>("contacts");
  const [bannerMessage, setBannerMessage] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const importPanelAnchorRef = useRef<HTMLDivElement>(null);
  const [quickVendorCategory, setQuickVendorCategory] = useState("");
  const [quickTemplateId, setQuickTemplateId] = useState<string | undefined>();
  const [vendorSearchQuery, setVendorSearchQuery] = useState("");
  const [vendorSort, setVendorSort] = useState<VendorSortKey>(DEFAULT_VENDOR_SORT);
  const vendorButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const { openSetup, refreshSetup } = useSetup();

  const reloadVendors = useCallback(async () => {
    if (!organizationId) return;
    setLoadingVendors(true);
    setLoadError("");
    try {
      const data = await fetchVendors(organizationId);
      setVendors(data);
      setSelectedVendorId((current) => {
        if (current && data.some((vendor) => vendor.id === current)) return current;
        return data[0]?.id ?? "";
      });
      await refreshSetup();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load vendors.");
    } finally {
      setLoadingVendors(false);
    }
  }, [organizationId, refreshSetup]);

  useEffect(() => {
    void reloadVendors();
  }, [reloadVendors]);

  useEffect(() => {
    if (!showImport) return;
    importPanelAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showImport]);

  useEffect(() => {
    if (!vendors.length) return;
    const vendorId = searchParams.get("vendor");
    const tab = searchParams.get("tab");
    if (vendorId && vendors.some((vendor) => vendor.id === vendorId)) {
      setSelectedVendorId(vendorId);
    }
    if (tab && tabs.includes(tab as Tab)) {
      setActiveTab(tab as Tab);
    }
  }, [searchParams, vendors]);

  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId) ?? vendors[0];

  useEffect(() => {
    if (!organizationId) return;
    setVendorSort(loadVendorSort(organizationId));
  }, [organizationId]);

  const visibleVendors = useMemo(() => {
    const filtered = filterAndRankVendors(vendors, vendorSearchQuery);
    return sortVendors(filtered, vendorSort);
  }, [vendors, vendorSearchQuery, vendorSort]);

  useEffect(() => {
    if (!selectedVendorId) return;
    const node = vendorButtonRefs.current.get(selectedVendorId);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedVendorId, visibleVendors.length]);

  useEffect(() => {
    if (!bannerMessage) return;
    const timer = window.setTimeout(() => setBannerMessage(""), 4000);
    return () => window.clearTimeout(timer);
  }, [bannerMessage]);

  async function updateVendorStatus(status: Status) {
    if (!selectedVendor) return;
    await updateVendorCore(selectedVendor.id, { status });
    await reloadVendors();
  }

  async function addVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || !organizationId) return;

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const category = String(form.get("category") || "").trim();
    if (!name || !category) return;

    try {
      const created = await createVendor(organizationId, {
        name,
        category,
        notes: "New vendor record.",
      });
      await reloadVendors();
      setSelectedVendorId(created.id);
      setActiveTab("contacts");
      setBannerMessage(`${name} added.`);
      setQuickVendorCategory("");
      setQuickTemplateId(undefined);
      event.currentTarget.reset();
    } catch (error) {
      setBannerMessage(error instanceof Error ? error.message : "Could not add vendor.");
    }
  }

  async function removeVendor(vendor: Vendor) {
    if (!canWrite || !organizationId) return;
    const confirmed = window.confirm(`Delete ${vendor.name} and all related records? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteVendor(vendor.id);
      await reloadVendors();
      setBannerMessage(`${vendor.name} removed.`);
    } catch (error) {
      setBannerMessage(error instanceof Error ? error.message : "Could not delete vendor.");
    }
  }

  async function loadSampleData() {
    if (!canWrite || !organizationId) return;
    setSeeding(true);
    try {
      await seedSampleVendors(organizationId);
      await reloadVendors();
      setBannerMessage("Sample vendors loaded into your workspace.");
    } catch (error) {
      setBannerMessage(error instanceof Error ? error.message : "Could not load sample data.");
    } finally {
      setSeeding(false);
    }
  }

  const readOnly = !canWrite;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div>
          <BrandLogo variant="sidebar" linkTo="/" />
          <p className="eyebrow sidebar-workspace">{activeMembership?.organization.name ?? "Workspace"}</p>
          <p className="small muted">
            Track vendors, contracts, documents, and spend for your clinic.
          </p>
          <p className="small muted">
            {user?.email}
            {activeMembership ? ` · ${activeMembership.role}` : ""}
          </p>
        </div>

        {memberships.length > 1 && (
          <label className="org-switcher">
            <span className="label">Workspace</span>
            <select
              value={organizationId}
              onChange={(event) => setActiveOrganizationId(event.target.value)}
            >
              {memberships.map((membership) => (
                <option key={membership.organizationId} value={membership.organizationId}>
                  {membership.organization.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <GlobalSearch
          organizationId={organizationId}
          vendors={vendors}
          onQueryChange={setVendorSearchQuery}
          onSelectVendor={(vendorId) => {
            setSelectedVendorId(vendorId);
            setActiveTab("contacts");
          }}
        />

        <div className="vendor-list-toolbar">
          <p className="label vendor-list-label">
            My vendors
            {vendorSearchQuery.trim() && (
              <span className="vendor-list-count">
                {" "}
                · {visibleVendors.length} of {vendors.length}
              </span>
            )}
          </p>
          <label className="vendor-sort-picker">
            <span className="sr-only">Sort vendors</span>
            <select
              aria-label="Sort vendors"
              onChange={(event) => {
                const next = event.target.value as VendorSortKey;
                setVendorSort(next);
                saveVendorSort(organizationId, next);
              }}
              value={vendorSort}
            >
              {VENDOR_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!readOnly && (
          <>
            <VendorTemplatePicker
              selectedId={quickTemplateId}
              onSelect={(template) => {
                setQuickTemplateId(template.id);
                setQuickVendorCategory(template.category);
              }}
            />
            <form className="quick-add" onSubmit={addVendor}>
              <input name="name" placeholder="New vendor name" />
              <input
                name="category"
                onChange={(event) => setQuickVendorCategory(event.target.value)}
                placeholder="Category (e.g. Lab, IT)"
                value={quickVendorCategory}
              />
              <button type="submit">Add Vendor</button>
            </form>
          </>
        )}

        <div className="vendor-list">
          {loadingVendors ? (
            <p className="muted small">Loading vendors…</p>
          ) : vendors.length === 0 ? (
            <p className="muted small">No vendors yet. Add one above or load sample data.</p>
          ) : visibleVendors.length === 0 ? (
            <p className="muted small">No vendors match your search.</p>
          ) : (
            visibleVendors.map((vendor) => (
              <button
                key={vendor.id}
                type="button"
                ref={(node) => {
                  if (node) vendorButtonRefs.current.set(vendor.id, node);
                  else vendorButtonRefs.current.delete(vendor.id);
                }}
                className={vendor.id === selectedVendor?.id ? "vendor-button selected" : "vendor-button"}
                onClick={() => setSelectedVendorId(vendor.id)}
              >
                <span>{vendor.name}</span>
                <small>{vendor.category}</small>
              </button>
            ))
          )}
        </div>

        <div className="sidebar-actions">
          {canWrite && vendors.length === 0 && !loadingVendors && (
            <button type="button" className="secondary full" onClick={loadSampleData} disabled={seeding}>
              {seeding ? "Loading sample data…" : "Load sample vendors"}
            </button>
          )}
          {canWrite && organizationId && (
            <>
              <input
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="drop-zone-input"
                id={sidebarImportInputId}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setPendingImportFile(file);
                  setShowImport(true);
                }}
                type="file"
              />
              <label className="secondary full sidebar-import-label" htmlFor={sidebarImportInputId}>
                Import from Excel/CSV
              </label>
            </>
          )}
        </div>
      </aside>

      <section className="content">
        {showImport && canWrite && organizationId && (
          <div ref={importPanelAnchorRef}>
            <VendorImportPanel
              initialFile={pendingImportFile}
              onClose={() => setShowImport(false)}
              onImported={() => void reloadVendors()}
              onInitialFileHandled={() => setPendingImportFile(null)}
              organizationId={organizationId}
            />
          </div>
        )}
        <RenewalsSummary organizationId={organizationId} compact />
        {loadError && <div className="banner error">{loadError}</div>}
        {bannerMessage && <div className="banner">{bannerMessage}</div>}
        {readOnly && (
          <div className="banner">You have viewer access in this workspace. Editing is disabled.</div>
        )}

        {!selectedVendor ? (
          <div className="empty-state">
            <h2>Get your vendor hub running</h2>
            <p className="muted">
              In a few minutes you&apos;ll know which contracts renew soon, which vendors are missing COI/W-9, and
              where spend is going.
            </p>
            {canWrite && !loadingVendors && (
              <div className="empty-state-actions">
                <button onClick={openSetup} type="button">
                  Start workspace setup
                </button>
                <button className="secondary" disabled={seeding} onClick={loadSampleData} type="button">
                  {seeding ? "Loading sample data…" : "Explore with sample vendors"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">Vendor Detail</p>
                <h2>{selectedVendor.name}</h2>
                <p className="muted">{selectedVendor.category}</p>
              </div>
              <div className="right-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    openVendorOnePager(selectedVendor, activeMembership?.organization.name ?? "Workspace")
                  }
                >
                  Print summary
                </button>
                <span className={getStatusClass(selectedVendor.status)}>{selectedVendor.status}</span>
                {!readOnly && (
                  <button type="button" className="delete" onClick={() => void removeVendor(selectedVendor)}>
                    Delete vendor
                  </button>
                )}
              </div>
            </header>

            <section className="info-grid">
              <div className="card">
                <p className="label">Category</p>
                <strong>{selectedVendor.category}</strong>
              </div>
              <div className="card">
                <p className="label">Status</p>
                <select
                  value={selectedVendor.status}
                  disabled={readOnly}
                  onChange={(event) => void updateVendorStatus(event.target.value as Status)}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="pending">Pending</option>
                  <option value="expired">Expired</option>
                </select>
              </div>
              <div className="card wide">
                <VendorAddressField
                  address={selectedVendor.address}
                  onSaved={reloadVendors}
                  readOnly={readOnly}
                  vendorId={selectedVendor.id}
                />
              </div>
              <div className="card wide">
                <VendorNotesEditor
                  notes={selectedVendor.notes}
                  notesLocked={selectedVendor.notesLocked ?? false}
                  onSaved={reloadVendors}
                  readOnly={readOnly}
                  vendorId={selectedVendor.id}
                />
              </div>
            </section>

            <nav className="tabs">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={activeTab === tab ? "active" : ""}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === "evaluations" ? "Scorecard" : tab}
                </button>
              ))}
            </nav>

            {activeTab === "contacts" && (
              <ContactsSection
                vendor={selectedVendor}
                organizationId={organizationId}
                readOnly={readOnly}
                onChanged={reloadVendors}
              />
            )}
            {activeTab === "contracts" && (
              <ContractsSection
                vendor={selectedVendor}
                organizationId={organizationId}
                readOnly={readOnly}
                onChanged={reloadVendors}
              />
            )}
            {activeTab === "spend" && (
              <LedgerSection
                vendor={selectedVendor}
                organizationId={organizationId}
                readOnly={readOnly}
                onChanged={reloadVendors}
              />
            )}
            {activeTab === "documents" && (
              <DocumentsSection
                vendor={selectedVendor}
                organizationId={organizationId}
                readOnly={readOnly}
                onChanged={reloadVendors}
              />
            )}
            {activeTab === "evaluations" && (
              <EvaluationsSection
                vendor={selectedVendor}
                organizationId={organizationId}
                readOnly={readOnly}
                onChanged={reloadVendors}
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}

function ContactsSection({
  vendor,
  organizationId,
  readOnly,
  onChanged,
}: {
  vendor: Vendor;
  organizationId: string;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  async function handleAddContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const form = new FormData(event.currentTarget);
    const contact = {
      name: String(form.get("name") || ""),
      role: String(form.get("role") || ""),
      email: String(form.get("email") || ""),
      phone: String(form.get("phone") || ""),
    };
    if (!contact.name || !contact.role || !contact.email || !contact.phone) return;
    await addContact(organizationId, vendor.id, contact);
    await onChanged();
    event.currentTarget.reset();
  }

  return (
    <Section title="Contacts" empty={!vendor.contacts.length} emptyText="No contacts added yet.">
      {!readOnly && (
        <FormGrid onSubmit={handleAddContact} submitText="Add Contact">
          <input name="name" placeholder="Name" />
          <input name="role" placeholder="Role" />
          <input name="email" placeholder="Email" type="email" />
          <input name="phone" placeholder="Phone" />
        </FormGrid>
      )}

      {vendor.contacts.map((contact) => (
        <div className="card row" key={contact.id}>
          <div>
            <strong>{contact.name}</strong>
            <p className="muted">{contact.role}</p>
            <p className="muted">
              {contact.email} · {contact.phone}
            </p>
          </div>
          {!readOnly && (
            <DeleteButton
              onClick={async () => {
                await deleteContact(contact.id);
                await onChanged();
              }}
            />
          )}
        </div>
      ))}
    </Section>
  );
}

function ContractsSection({
  vendor,
  organizationId,
  readOnly,
  onChanged,
}: {
  vendor: Vendor;
  organizationId: string;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [viewingFile, setViewingFile] = useState<FileAttachment | null>(null);

  useEffect(() => {
    return () => revokeAttachmentUrl(viewingFile);
  }, [viewingFile]);

  function closeFileViewer() {
    setViewingFile((current) => {
      revokeAttachmentUrl(current);
      return null;
    });
  }

  function previewAttachment(attachment: FileAttachment) {
    setViewingFile((current) => {
      revokeAttachmentUrl(current);
      return attachment;
    });
  }

  function previewLocalFile(file: File) {
    previewAttachment(localFileToAttachment(file));
  }

  async function handleAddContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    setFormError("");
    const form = new FormData(event.currentTarget);

    const contract: Omit<Contract, "id"> = {
      name: String(form.get("name") || ""),
      startDate: String(form.get("startDate") || ""),
      endDate: String(form.get("endDate") || ""),
      value: Number(form.get("value") || 0),
      status: String(form.get("status") || "pending") as Status,
    };
    if (!contract.name || !contract.startDate || !contract.endDate) {
      setFormError("Name, start date, and end date are required.");
      return;
    }

    setSaving(true);
    try {
      if (contractFile) {
        contract.file = await fileToStorageAttachment(organizationId, vendor.id, contractFile);
      }
      await addContract(organizationId, vendor.id, contract);
      await onChanged();
      event.currentTarget.reset();
      setContractFile(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not attach file.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Contracts" empty={!vendor.contracts.length} emptyText="No contracts added yet.">
      {!readOnly && (
        <>
          <div className="notice">
            Attach a PDF or document when adding a contract. Files are stored securely in your workspace (up to{" "}
            {formatFileSize(MAX_FILE_BYTES)} each).
          </div>
          <FormGrid onSubmit={handleAddContract} submitText={saving ? "Saving…" : "Add Contract"} disabled={saving}>
            <input name="name" placeholder="Contract name" />
            <label className="field-block">
              <span className="label">{CONTRACT_START_LABEL}</span>
              <input name="startDate" required type="date" />
              <span className="muted small">{CONTRACT_START_HINT}</span>
            </label>
            <label className="field-block">
              <span className="label">{CONTRACT_END_LABEL}</span>
              <input name="endDate" required type="date" />
              <span className="muted small">{CONTRACT_END_HINT}</span>
            </label>
            <input name="value" placeholder="Value" type="number" />
            <select name="status" defaultValue="pending">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
            </select>
            <FileDropZone
              multiple={false}
              disabled={saving}
              hint="PDF, Word, Excel, or images · optional"
              onFiles={(files) => setContractFile(files[0] ?? null)}
            />
            {contractFile && (
              <p className="selected-file">
                <span>Attached:</span>
                <button
                  type="button"
                  className="doc-title-button"
                  onClick={() => previewLocalFile(contractFile)}
                >
                  {contractFile.name}
                </button>
                <span className="muted small">({formatFileSize(contractFile.size)})</span>
                <button
                  type="button"
                  className="secondary doc-view-button"
                  onClick={() => previewLocalFile(contractFile)}
                >
                  View
                </button>
                <button type="button" className="text-button" onClick={() => setContractFile(null)}>
                  Remove
                </button>
              </p>
            )}
          </FormGrid>
        </>
      )}
      {formError && <p className="form-error">{formError}</p>}

      {vendor.contracts.map((contract) => (
        <div className="card row" key={contract.id}>
          <div>
            <strong>{contract.name}</strong>
            <p className="muted small">
              {CONTRACT_START_LABEL}: {prettyDate(contract.startDate)}
              <br />
              {CONTRACT_END_LABEL}: {prettyDate(contract.endDate)}
            </p>
            <p>{money(contract.value)}</p>
            {contract.file && (
              <div className="file-meta">
                <FileAttachmentLink
                  fileUrl={contract.file.fileUrl}
                  fileName={contract.file.fileName}
                  fileSize={contract.file.fileSize}
                  onClick={(event) => {
                    event.preventDefault();
                    previewAttachment(contract.file!);
                  }}
                />
                <button
                  type="button"
                  className="secondary doc-view-button"
                  onClick={() => previewAttachment(contract.file!)}
                >
                  View
                </button>
              </div>
            )}
          </div>
          <div className="right-actions">
            <span className={getStatusClass(contract.status)}>{contract.status}</span>
            {!readOnly && (
              <DeleteButton
                onClick={async () => {
                  await deleteContract(contract.id);
                  await onChanged();
                }}
              />
            )}
          </div>
        </div>
      ))}
      {viewingFile && (
        <DocumentViewerModal
          fileUrl={viewingFile.fileUrl}
          fileName={viewingFile.fileName}
          fileSize={viewingFile.fileSize}
          mimeType={viewingFile.mimeType}
          onClose={closeFileViewer}
        />
      )}
    </Section>
  );
}

function LedgerSection({
  vendor,
  organizationId,
  readOnly,
  onChanged,
}: {
  vendor: Vendor;
  organizationId: string;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const total = useMemo(() => {
    return vendor.ledger.reduce((sum, entry) => {
      return entry.type === "payment" ? sum - entry.amount : sum + entry.amount;
    }, 0);
  }, [vendor.ledger]);

  async function handleAddEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const form = new FormData(event.currentTarget);
    const entry = {
      date: String(form.get("date") || ""),
      description: String(form.get("description") || ""),
      amount: Number(form.get("amount") || 0),
      type: String(form.get("type") || "payment") as LedgerEntry["type"],
    };
    if (!entry.date || !entry.description || !entry.amount) return;
    await addLedgerEntry(organizationId, vendor.id, entry);
    await onChanged();
    event.currentTarget.reset();
  }

  return (
    <Section title="Vendor Spend Tracker" empty={!vendor.ledger.length} emptyText="No spend entries yet.">
      <div className="notice">
        Lightweight spend comparison — not accounting software. Track payments, credits, and notes for vendor decisions.
      </div>
      <div className="card highlight">
        <p className="label">Net spend balance</p>
        <strong>{money(total)}</strong>
      </div>

      {!readOnly && (
        <FormGrid onSubmit={handleAddEntry} submitText="Add Entry">
          <input name="date" type="date" />
          <input name="description" placeholder="Description" />
          <input name="amount" placeholder="Amount" type="number" step="0.01" />
          <select name="type" defaultValue="payment">
            <option value="payment">Payment</option>
            <option value="credit">Credit</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </FormGrid>
      )}

      {vendor.ledger.map((entry) => (
        <div className="card row" key={entry.id}>
          <div>
            <strong>{entry.description}</strong>
            <p className="muted">{prettyDate(entry.date)}</p>
          </div>
          <div className="right-actions">
            <strong className={entry.type === "payment" ? "negative" : "positive"}>
              {entry.type === "payment" ? "-" : "+"}
              {money(entry.amount)}
            </strong>
            {!readOnly && (
              <DeleteButton
                onClick={async () => {
                  await deleteLedgerEntry(entry.id);
                  await onChanged();
                }}
              />
            )}
          </div>
        </div>
      ))}
    </Section>
  );
}

function DocumentsSection({
  vendor,
  organizationId,
  readOnly,
  onChanged,
}: {
  vendor: Vendor;
  organizationId: string;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<DocumentDocType>("general");
  const [expiresAt, setExpiresAt] = useState("");
  const [viewingDocument, setViewingDocument] = useState<DocumentItem | null>(null);

  async function uploadFiles(files: File[]) {
    if (!files.length || readOnly) return;

    setUploading(true);
    setUploadError("");

    try {
      for (const file of files) {
        const attachment = await fileToStorageAttachment(organizationId, vendor.id, file);
        await addDocument(organizationId, vendor.id, {
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          createdAt: new Date().toISOString().slice(0, 10),
          fileUrl: attachment.fileUrl,
          docType,
          expiresAt: expiresAt || undefined,
        });
      }
      await onChanged();
      setExpiresAt("");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Section title="Documents" empty={!vendor.documents.length} emptyText="No documents uploaded yet.">
      {!readOnly && (
        <>
          <div className="notice">
            Upload PDFs, Word docs, spreadsheets, or images. Tag COI and W-9 documents for compliance tracking.
          </div>
          <div className="upload-panel card">
            <div className="form-grid">
              <label className="field-block">
                <span className="label">Document type</span>
                <select value={docType} onChange={(event) => setDocType(event.target.value as DocumentDocType)}>
                  {COMPLIANCE_DOC_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-block">
                <span className="label">Expires (optional)</span>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </label>
            </div>
            <FileDropZone
              multiple
              disabled={uploading}
              hint={`Up to ${formatFileSize(MAX_FILE_BYTES)} per file · multiple files OK`}
              onFiles={uploadFiles}
            />
            {uploading && <p className="muted">Uploading…</p>}
            {uploadError && <p className="form-error">{uploadError}</p>}
          </div>
        </>
      )}

      {vendor.documents.map((document) => (
        <div className="card row" key={document.id}>
          <div>
            {hasDownloadableFile(document.fileUrl) ? (
              <button
                type="button"
                className="doc-title-button"
                onClick={() => setViewingDocument(document)}
              >
                📄 {document.fileName}
              </button>
            ) : (
              <strong>📄 {document.fileName}</strong>
            )}
            <p className="muted">
              {complianceLabel(document.docType)} · {formatFileSize(document.fileSize)} ·{" "}
              {prettyDate(document.createdAt)}
              {document.expiresAt ? ` · expires ${prettyDate(document.expiresAt)}` : ""}
            </p>
          </div>
          <div className="right-actions">
            {hasDownloadableFile(document.fileUrl) && (
              <button
                type="button"
                className="secondary doc-view-button"
                onClick={() => setViewingDocument(document)}
              >
                View
              </button>
            )}
            {!hasDownloadableFile(document.fileUrl) && <span className="muted small">No file attached</span>}
            {!readOnly && (
              <DeleteButton
                onClick={async () => {
                  await deleteDocument(document.id);
                  await onChanged();
                }}
              />
            )}
          </div>
        </div>
      ))}
      {viewingDocument && (
        <DocumentViewerModal
          fileUrl={viewingDocument.fileUrl}
          fileName={viewingDocument.fileName}
          fileSize={viewingDocument.fileSize}
          onClose={() => setViewingDocument(null)}
        />
      )}
    </Section>
  );
}

function FileDropZone({
  multiple = false,
  disabled = false,
  hint,
  onFiles,
}: {
  multiple?: boolean;
  disabled?: boolean;
  hint: string;
  onFiles: (files: File[]) => void | Promise<void>;
}) {
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(fileList: FileList | null) {
    if (!fileList?.length || disabled) return;
    const files = Array.from(fileList);
    void onFiles(multiple ? files : files.slice(0, 1));
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) setIsDragging(true);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const related = event.relatedTarget as Node | null;
    if (!related || !event.currentTarget.contains(related)) {
      setIsDragging(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    handleFiles(event.dataTransfer.files);
  }

  return (
    <div
      className={`drop-zone ${isDragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        id={inputId}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple={multiple}
        disabled={disabled}
        className="drop-zone-input"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <label htmlFor={inputId} className="drop-zone-label">
        <strong>{isDragging ? "Drop to upload" : "Drag & drop files here"}</strong>
        <span className="muted">or click to browse · {hint}</span>
      </label>
    </div>
  );
}

function Section({ title, empty, emptyText, children }: { title: string; empty: boolean; emptyText: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-header">
        <h3>{title}</h3>
      </div>
      {children}
      {empty && <div className="empty">{emptyText}</div>}
    </section>
  );
}

function FormGrid({
  children,
  submitText,
  onSubmit,
  disabled,
}: {
  children: React.ReactNode;
  submitText: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  disabled?: boolean;
}) {
  return (
    <form className="form-grid card" onSubmit={onSubmit}>
      {children}
      <button type="submit" disabled={disabled}>
        {submitText}
      </button>
    </form>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="delete" onClick={onClick} aria-label="Delete">
      Delete
    </button>
  );
}
