import { DragEvent, FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { acknowledgeAiDisclosureIfNeeded } from "./lib/aiDisclosure";
import { MAIN_CONTENT_ID } from "./lib/a11y";
import {
  extractContractFromPdf,
  fetchContractExtractStatus,
  isPdfFile,
  type ContractExtractResult,
} from "./api/contractExtract";
import {
  extractDocumentFromPdf,
  extractDocumentFromUrl,
  type DocumentExtractResult,
} from "./api/documentExtract";
import { fetchIsPlatformAdmin } from "./api/foundingApplication";
import {
  addContact,
  addContract,
  addLedgerEntry,
  createVendor,
  deleteContact,
  deleteContract,
  deleteDocument,
  deleteLedgerEntry,
  deleteSampleVendors,
  deleteVendor,
  fetchVendors,
  rollbackOrgUpload,
  seedSampleVendors,
  updateContact,
  updateContract,
  updateVendorCore,
  uploadAndAddDocument,
  uploadOrgFile,
  setRenewalHandled,
} from "./api/vendors";
import { holdFilePreviewTab } from "./api/filePreview";
import { BrandLogo } from "./components/BrandLogo";
import { ContractRenewalLossBadge } from "./components/ContractRenewalLossBadge";
import { DocumentViewerModal } from "./components/DocumentViewerModal";
import { EvaluationsSection } from "./components/EvaluationsSection";
import { FileAttachmentLink } from "./components/FileAttachmentLink";
import { GlobalSearch } from "./components/GlobalSearch";
import { ItemFilterChips, LifecycleBadge } from "./components/ItemFilterChips";
import { VendorImportPanel } from "./components/VendorImportPanel";
import { VendorAddressField } from "./components/VendorAddressField";
import { VendorIdentityFields } from "./components/VendorIdentityFields";
import { VendorContactEmailPanel } from "./components/VendorContactEmailPanel";
import { VendorNotesEditor } from "./components/VendorNotesEditor";
import { VendorTemplatePicker } from "./components/VendorTemplatePicker";
import { RenewalsSummary } from "./pages/RenewalsPage";
import { useOrganization } from "./contexts/OrganizationContext";
import { useSetup } from "./contexts/SetupContext";
import { COMPLIANCE_DOC_TYPES, complianceLabel } from "./lib/attention";
import {
  buildSpendPrefill,
  extractDocumentTypeLabel,
  isContractLikeDocumentType,
  isMemoDocumentType,
  isSpendDocumentType,
  mapExtractDocumentTypeToDocType,
  type SpendPrefill,
} from "./lib/documentTypes";
import { filterAndRankVendors } from "./lib/search";
import {
  classifyContract,
  classifyDocument,
  loadViewedIds,
  markViewed,
  matchesLifecycleFilter,
  lifecycleSortDate,
  type ItemLifecycleFilter,
} from "./lib/itemLifecycle";
import { countSampleVendors, isSampleVendor } from "./lib/sampleVendors";
import {
  loadSelectedVendorId,
  resolveSelectedVendorId,
  saveSelectedVendorId,
} from "./lib/vendorSelection";
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
  getFilePreviewKind,
  localFileToAttachment,
  money,
  prettyDate,
  revokeAttachmentUrl,
} from "./lib/utils";
import {
  CONTRACT_END_HINT,
  CONTRACT_END_LABEL,
  CONTRACT_REVIEW_HINT,
  CONTRACT_REVIEW_LABEL,
  CONTRACT_START_HINT,
  CONTRACT_START_LABEL,
  RENEWAL_TYPE_OPTIONS,
  addMonthsToIsoDate,
  computeSuggestedReviewDate,
  daysUntilEnd,
  getContractUrgencyDate,
  isContractOverdue,
  isInOpenRenewalsWindow,
  renewalTypeLabel,
  validateContractDates,
} from "./lib/renewals";
import { enrichContractExtractResult, missingRequiredContractFields } from "./lib/contractExtractEnrich";
import { getSupabaseEdgeSecretsUrl, getSupabaseSqlEditorUrl } from "./lib/storage";
import { getMedianContractValue } from "./lib/renewalLossCalculator";
import type {
  Contact,
  Contract,
  ContractRenewalType,
  DocumentDocType,
  DocumentItem,
  FileAttachment,
  LedgerEntry,
  Status,
  Vendor,
} from "./types";

const tabs = ["contacts", "contracts", "spend", "documents", "evaluations"] as const;
type Tab = (typeof tabs)[number];

type ContractFormDraft = {
  name: string;
  startDate: string;
  endDate: string;
  renewalDate: string;
  renewalType: ContractRenewalType;
  noticePeriodDays: string;
  termMonths: string;
  value: string;
  status: Status;
  file: File | null;
  extractError: string;
  extractNotice: string;
  extracting: boolean;
};

function emptyContractDraft(): ContractFormDraft {
  return {
    name: "",
    startDate: "",
    endDate: "",
    renewalDate: "",
    renewalType: "fixed_term",
    noticePeriodDays: "",
    termMonths: "",
    value: "",
    status: "active",
    file: null,
    extractError: "",
    extractNotice: "",
    extracting: false,
  };
}

function buildContractExtractNotice(result: ContractExtractResult, draftAfter: ContractFormDraft): string {
  const filled: string[] = [];
  if (result.name) filled.push("name");
  if (result.startDate) filled.push("start date");
  if (result.endDate) filled.push("end date");
  if (result.renewalDate) filled.push("review date");
  if (result.renewalType && result.renewalType !== "fixed_term") {
    filled.push(renewalTypeLabel(result.renewalType).toLowerCase());
  }
  if (result.noticePeriodDays != null) filled.push("notice period");
  if (result.termMonths != null) filled.push("term length");
  if (result.value != null) filled.push("value");

  const typeLabel = result.documentTypeLabel ?? extractDocumentTypeLabel(result.documentType);
  const stillMissing = missingRequiredContractFields({
    name: draftAfter.name,
    startDate: draftAfter.startDate,
    endDate: draftAfter.endDate,
    renewalDate: draftAfter.renewalDate,
    renewalType: draftAfter.renewalType,
  });

  if (!typeLabel && filled.length === 0) {
    return "Could not find document details in this PDF. Enter details manually.";
  }

  const detailText =
    filled.length > 0 ? `Pre-filled ${filled.join(", ")}.` : "Review the detected document type.";

  const missingText =
    stillMissing.length > 0
      ? ` Still need: ${stillMissing.join(", ")} — fill in below or re-scan.`
      : " Review below, then click Add Contract.";

  const hintText =
    result.extractHints && result.extractHints.length > 0
      ? ` ${result.extractHints.join(" ")}`
      : "";

  if (typeLabel) {
    return `Detected ${typeLabel}. ${detailText}${missingText}${hintText}`;
  }
  return `${detailText}${missingText}${hintText}`;
}

function applyContractExtractToDraft(
  draft: ContractFormDraft,
  result: ContractExtractResult
): Partial<ContractFormDraft> {
  const enriched = enrichContractExtractResult(result);
  const patch: Partial<ContractFormDraft> = {};
  if (enriched.name) patch.name = enriched.name;
  if (enriched.startDate) patch.startDate = enriched.startDate;
  if (enriched.endDate) patch.endDate = enriched.endDate;
  if (enriched.value != null && Number.isFinite(enriched.value)) patch.value = String(enriched.value);

  if (enriched.renewalType) {
    patch.renewalType = enriched.renewalType;
  } else if (enriched.autoRenew === true) {
    patch.renewalType = "auto_renew";
  } else if (enriched.autoRenew === false && !enriched.endDate) {
    patch.renewalType = "evergreen";
  }

  if (enriched.noticePeriodDays != null && enriched.noticePeriodDays >= 0) {
    patch.noticePeriodDays = String(enriched.noticePeriodDays);
  }
  if (enriched.termMonths != null && enriched.termMonths > 0) {
    patch.termMonths = String(enriched.termMonths);
  }

  const mergedType = patch.renewalType ?? draft.renewalType;
  const startDate = enriched.startDate ?? draft.startDate;
  const termMonths =
    enriched.termMonths ?? (patch.termMonths ? Number(patch.termMonths) : draft.termMonths ? Number(draft.termMonths) : null);
  const noticeDays =
    enriched.noticePeriodDays ??
    (patch.noticePeriodDays ? Number(patch.noticePeriodDays) : draft.noticePeriodDays ? Number(draft.noticePeriodDays) : null);

  if (enriched.renewalDate) {
    patch.renewalDate = enriched.renewalDate;
  } else if (
    startDate &&
    termMonths &&
    (mergedType === "auto_renew" || enriched.autoRenew === true)
  ) {
    patch.renewalDate = computeSuggestedReviewDate({
      startDate,
      termMonths,
      noticePeriodDays: noticeDays,
    });
  }

  if (mergedType === "fixed_term" && !patch.endDate && !draft.endDate && startDate && termMonths) {
    patch.endDate = addMonthsToIsoDate(startDate, termMonths);
  }

  if (enriched.autoRenew === true || patch.renewalType === "auto_renew") {
    patch.status = "active";
  } else if (patch.startDate && (patch.endDate || patch.renewalDate)) {
    patch.status = "active";
  }

  return patch;
}

function mergeVendorDocuments(vendors: Vendor[], vendorId: string, document: DocumentItem): Vendor[] {
  return vendors.map((vendor) => {
    if (vendor.id !== vendorId) return vendor;
    if (vendor.documents.some((item) => item.id === document.id)) return vendor;
    return { ...vendor, documents: [...vendor.documents, document] };
  });
}

function mergeVendorContracts(vendors: Vendor[], vendorId: string, contract: Contract): Vendor[] {
  return vendors.map((vendor) => {
    if (vendor.id !== vendorId) return vendor;
    if (vendor.contracts.some((item) => item.id === contract.id)) {
      return {
        ...vendor,
        contracts: vendor.contracts.map((item) => (item.id === contract.id ? contract : item)),
      };
    }
    return { ...vendor, contracts: [...vendor.contracts, contract] };
  });
}

function contractToDraft(contract: Contract): ContractFormDraft {
  return {
    ...emptyContractDraft(),
    name: contract.name,
    startDate: contract.startDate,
    endDate: contract.endDate ?? "",
    renewalDate: contract.renewalDate ?? "",
    renewalType: contract.renewalType,
    noticePeriodDays:
      contract.noticePeriodDays != null ? String(contract.noticePeriodDays) : "",
    termMonths: contract.termMonths != null ? String(contract.termMonths) : "",
    value: String(contract.value),
    status: contract.status,
  };
}

function buildContractPayload(draft: ContractFormDraft): Omit<Contract, "id"> {
  return {
    name: draft.name.trim(),
    startDate: draft.startDate,
    endDate: draft.endDate || null,
    // Fixed-term renewals are driven by end date; drop leftover review dates from extract/type switches.
    renewalDate: draft.renewalType === "fixed_term" ? null : draft.renewalDate || null,
    renewalType: draft.renewalType,
    noticePeriodDays: draft.noticePeriodDays ? Number(draft.noticePeriodDays) : null,
    termMonths: draft.termMonths ? Number(draft.termMonths) : null,
    value: Number(draft.value || 0),
    status: draft.status,
  };
}

function workspaceOptionLabel(name: string, organizationId: string, memberships: { organization: { name: string } }[]) {
  const duplicateNames = memberships.filter((item) => item.organization.name === name).length > 1;
  if (!duplicateNames) return name;
  return `${name} (${organizationId.slice(0, 8)})`;
}

function mergePendingDocuments(
  saved: DocumentItem[],
  pending: DocumentItem[]
): DocumentItem[] {
  const savedIds = new Set(saved.map((doc) => doc.id));
  const visiblePending = pending.filter((doc) => !savedIds.has(doc.id));
  return [...saved, ...visiblePending];
}

const CLINIC_EXTRACT_UNAVAILABLE =
  "AI extraction temporarily unavailable — enter details manually";

const CLINIC_DOCUMENT_EXTRACT_UNAVAILABLE =
  "AI document reading temporarily unavailable — upload and tag manually";

const NON_PDF_CONTRACT_EXTRACT_MESSAGE =
  "AI can only read PDF contracts. Export Word or other files to PDF to auto-fill name and dates, or enter details manually.";

function isAdminExtractError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    message.includes("OPENAI_API_KEY") ||
    message.includes("setup-contract-extract") ||
    lower.includes("edge function secrets") ||
    lower.includes("not deployed")
  );
}

export function VendorWorkspace() {
  const { activeMembership, memberships, canWrite, setActiveOrganizationId } = useOrganization();
  const organizationId = activeMembership?.organizationId ?? "";
  const sidebarImportInputId = useId();
  const [searchParams, setSearchParams] = useSearchParams();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [editingVendorIdentity, setEditingVendorIdentity] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("contacts");
  const [bannerMessage, setBannerMessage] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [removingSamples, setRemovingSamples] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const importPanelAnchorRef = useRef<HTMLDivElement>(null);
  const [quickVendorCategory, setQuickVendorCategory] = useState("");
  const [quickTemplateId, setQuickTemplateId] = useState<string | undefined>();
  const [vendorSearchQuery, setVendorSearchQuery] = useState("");
  const [vendorSort, setVendorSort] = useState<VendorSortKey>(DEFAULT_VENDOR_SORT);
  const vendorButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const vendorsFetchGenRef = useRef(0);
  const { openSetup, refreshSetup } = useSetup();
  const [pendingDocumentsByVendor, setPendingDocumentsByVendor] = useState<Record<string, DocumentItem[]>>({});
  const [contractDraftsByVendor, setContractDraftsByVendor] = useState<Record<string, ContractFormDraft>>({});
  const contractExtractRequestIdRef = useRef<Record<string, number>>({});
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const appliedSearchParamsRef = useRef("");

  const selectVendor = useCallback(
    (vendorId: string) => {
      setSelectedVendorId(vendorId);
      if (organizationId) saveSelectedVendorId(organizationId, vendorId);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (vendorId) next.set("vendor", vendorId);
          else next.delete("vendor");
          return next;
        },
        { replace: true }
      );
    },
    [organizationId, setSearchParams]
  );

  const selectTab = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("tab", tab);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  useEffect(() => {
    void fetchIsPlatformAdmin().then(setIsPlatformAdmin);
  }, []);

  const getContractDraft = useCallback(
    (vendorId: string) => contractDraftsByVendor[vendorId] ?? emptyContractDraft(),
    [contractDraftsByVendor]
  );

  const updateContractDraft = useCallback((vendorId: string, patch: Partial<ContractFormDraft>) => {
    setContractDraftsByVendor((current) => ({
      ...current,
      [vendorId]: { ...(current[vendorId] ?? emptyContractDraft()), ...patch },
    }));
  }, []);

  const clearContractDraft = useCallback((vendorId: string) => {
    setContractDraftsByVendor((current) => {
      if (!(vendorId in current)) return current;
      const next = { ...current };
      delete next[vendorId];
      return next;
    });
  }, []);

  const reloadVendors = useCallback(async (options?: { silent?: boolean }) => {
    if (!organizationId) return;
    const fetchGen = ++vendorsFetchGenRef.current;
    const silent = Boolean(options?.silent);
    if (!silent) {
      setLoadingVendors(true);
      setLoadError("");
    }
    try {
      const data = await fetchVendors(organizationId);
      if (fetchGen !== vendorsFetchGenRef.current) return;
      setVendors(data);
      setSelectedVendorId((current) => {
        const resolved = resolveSelectedVendorId(data, current, organizationId);
        if (resolved) saveSelectedVendorId(organizationId, resolved);
        return resolved;
      });
      if (!silent) {
        await refreshSetup();
      }
    } catch (error) {
      if (fetchGen !== vendorsFetchGenRef.current) return;
      setLoadError(error instanceof Error ? error.message : "Could not load vendors.");
    } finally {
      if (!silent && fetchGen === vendorsFetchGenRef.current) {
        setLoadingVendors(false);
      }
    }
  }, [organizationId, refreshSetup]);

  const stagePendingDocument = useCallback((vendorId: string, document: DocumentItem) => {
    setPendingDocumentsByVendor((current) => ({
      ...current,
      [vendorId]: [...(current[vendorId] ?? []), document],
    }));
  }, []);

  const clearPendingDocument = useCallback((vendorId: string, documentId: string) => {
    setPendingDocumentsByVendor((current) => ({
      ...current,
      [vendorId]: (current[vendorId] ?? []).filter((doc) => doc.id !== documentId),
    }));
  }, []);

  const commitSavedDocument = useCallback((vendorId: string, pendingId: string, document: DocumentItem) => {
    clearPendingDocument(vendorId, pendingId);
    setVendors((current) => mergeVendorDocuments(current, vendorId, document));
  }, [clearPendingDocument]);

  const commitSavedContract = useCallback((vendorId: string, contract: Contract) => {
    setVendors((current) => mergeVendorContracts(current, vendorId, contract));
  }, []);

  useEffect(() => {
    setVendors([]);
    setSelectedVendorId(loadSelectedVendorId(organizationId));
    setPendingDocumentsByVendor({});
    setContractDraftsByVendor({});
    setLoadError("");
    appliedSearchParamsRef.current = "";
  }, [organizationId]);

  useEffect(() => {
    void reloadVendors();
  }, [reloadVendors]);

  useEffect(() => {
    const syncVendors = () => void reloadVendors();
    window.addEventListener("suppliersync:vendors-changed", syncVendors);
    return () => window.removeEventListener("suppliersync:vendors-changed", syncVendors);
  }, [reloadVendors]);

  useEffect(() => {
    if (!showImport) return;
    importPanelAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showImport]);

  useEffect(() => {
    const paramsKey = searchParams.toString();
    if (appliedSearchParamsRef.current === paramsKey) return;
    appliedSearchParamsRef.current = paramsKey;

    const vendorId = searchParams.get("vendor");
    const tab = searchParams.get("tab");
    if (vendorId) {
      setSelectedVendorId(vendorId);
      if (organizationId) saveSelectedVendorId(organizationId, vendorId);
    }
    if (tab && tabs.includes(tab as Tab)) {
      setActiveTab(tab as Tab);
    }
  }, [searchParams, organizationId]);

  useEffect(() => {
    if (!vendors.length) return;
    setSelectedVendorId((current) => {
      if (current && vendors.some((vendor) => vendor.id === current)) return current;
      const resolved = resolveSelectedVendorId(vendors, current, organizationId);
      if (resolved) saveSelectedVendorId(organizationId, resolved);
      return resolved;
    });
  }, [vendors, organizationId]);

  useEffect(() => {
    function preventFileDropNavigation(event: globalThis.DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    }
    window.addEventListener("dragover", preventFileDropNavigation);
    window.addEventListener("drop", preventFileDropNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileDropNavigation);
      window.removeEventListener("drop", preventFileDropNavigation);
    };
  }, []);

  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId) ?? null;
  const sampleVendorCount = countSampleVendors(vendors);

  useEffect(() => {
    if (!organizationId) return;
    setVendorSort(loadVendorSort(organizationId));
  }, [organizationId]);

  const visibleVendors = useMemo(() => {
    const filtered = filterAndRankVendors(vendors, vendorSearchQuery);
    return sortVendors(filtered, vendorSort);
  }, [vendors, vendorSearchQuery, vendorSort]);

  const medianContractValue = useMemo(() => getMedianContractValue(vendors), [vendors]);

  useEffect(() => {
    if (!selectedVendorId) return;
    const node = vendorButtonRefs.current.get(selectedVendorId);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedVendorId, visibleVendors.length]);

  useEffect(() => {
    setEditingVendorIdentity(false);
  }, [selectedVendorId]);

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
      selectVendor(created.id);
      selectTab("contacts");
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
      window.dispatchEvent(new CustomEvent("suppliersync:vendors-changed"));
      setBannerMessage(`${vendor.name} removed.`);
    } catch (error) {
      setBannerMessage(error instanceof Error ? error.message : "Could not delete vendor.");
    }
  }

  async function removeAllSampleVendors() {
    if (!canWrite || !organizationId || sampleVendorCount === 0) return;
    const confirmed = window.confirm(
      `Remove ${sampleVendorCount} sample vendor${sampleVendorCount === 1 ? "" : "s"} and all related records? This cannot be undone.`
    );
    if (!confirmed) return;

    setRemovingSamples(true);
    try {
      const removed = await deleteSampleVendors(organizationId);
      await reloadVendors();
      window.dispatchEvent(new CustomEvent("suppliersync:vendors-changed"));
      setBannerMessage(removed > 0 ? `${removed} sample vendor${removed === 1 ? "" : "s"} removed.` : "No sample vendors found.");
    } catch (error) {
      setBannerMessage(error instanceof Error ? error.message : "Could not remove sample vendors.");
    } finally {
      setRemovingSamples(false);
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
    <main className="shell" id={MAIN_CONTENT_ID}>
      <aside className="sidebar" aria-label="Vendor navigation">
        <div>
          <BrandLogo variant="sidebar" linkTo="/" />
          <p className="eyebrow sidebar-workspace">{activeMembership?.organization.name ?? "Workspace"}</p>
          <p className="small muted">
            Track vendors, contracts, documents, and spend for your clinic.
          </p>
          <p className="small muted">
            {activeMembership ? activeMembership.role : "Member"}
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
                  {workspaceOptionLabel(membership.organization.name, membership.organizationId, memberships)}
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
            selectVendor(vendorId);
            selectTab("contacts");
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
              <label className="sr-only" htmlFor="quick-vendor-name">
                New vendor name
              </label>
              <input id="quick-vendor-name" name="name" placeholder="New vendor name" />
              <label className="sr-only" htmlFor="quick-vendor-category">
                Category
              </label>
              <input
                id="quick-vendor-category"
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
                aria-current={vendor.id === selectedVendor?.id ? "true" : undefined}
                aria-label={`${vendor.name}, ${vendor.category}`}
                onClick={() => selectVendor(vendor.id)}
              >
                <span className="vendor-button-name">
                  {vendor.name}
                  {isSampleVendor(vendor) && <small className="vendor-sample-badge">Sample</small>}
                </span>
                <small>{vendor.category}</small>
              </button>
            ))
          )}
        </div>

        <div className="sidebar-actions">
          {canWrite && sampleVendorCount > 0 && !loadingVendors && (
            <button
              type="button"
              className="delete full"
              disabled={removingSamples}
              onClick={() => void removeAllSampleVendors()}
            >
              {removingSamples ? "Removing samples…" : `Remove ${sampleVendorCount} sample vendor${sampleVendorCount === 1 ? "" : "s"}`}
            </button>
          )}
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
        <h1 className="sr-only">Vendor workspace</h1>
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
        <RenewalsSummary
          compact
          medianContractValue={medianContractValue}
          organizationId={organizationId}
          vendors={vendors}
        />
        {loadError && (
          <div className="banner error" role="alert">
            {loadError}
          </div>
        )}
        {bannerMessage && (
          <div className="banner" role="status" aria-live="polite">
            {bannerMessage}
          </div>
        )}
        {canWrite && sampleVendorCount > 0 && (
          <div className="banner sample-vendors-banner">
            <span>
              {sampleVendorCount} sample vendor{sampleVendorCount === 1 ? "" : "s"} loaded for exploration (Northstar, Brightline).
              Select one and click <strong>Delete vendor</strong>, or remove all at once.
            </span>
            <button
              type="button"
              className="delete"
              disabled={removingSamples}
              onClick={() => void removeAllSampleVendors()}
            >
              {removingSamples ? "Removing…" : "Remove all samples"}
            </button>
          </div>
        )}
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
              <div className="vendor-detail-heading">
                <p className="eyebrow">Vendor Detail</p>
                {editingVendorIdentity && !readOnly ? (
                  <div className="card vendor-identity-edit-panel">
                    <VendorIdentityFields
                      autoFocus
                      category={selectedVendor.category}
                      name={selectedVendor.name}
                      onCancel={() => setEditingVendorIdentity(false)}
                      onSaved={async () => {
                        await reloadVendors();
                        setEditingVendorIdentity(false);
                      }}
                      readOnly={readOnly}
                      vendorId={selectedVendor.id}
                    />
                  </div>
                ) : (
                  <>
                    <div className="vendor-detail-title-row">
                      <h2>{selectedVendor.name}</h2>
                      {!readOnly && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setEditingVendorIdentity(true)}
                        >
                          Edit vendor
                        </button>
                      )}
                    </div>
                    <p className="muted">
                      {selectedVendor.category}
                      {isSampleVendor(selectedVendor) && (
                        <span className="vendor-sample-badge vendor-sample-badge--inline">Sample data</span>
                      )}
                    </p>
                  </>
                )}
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
                  notes={selectedVendor.stickyNotes ?? []}
                  onNotesChange={(stickyNotes) => {
                    const vendorId = selectedVendor.id;
                    setVendors((current) =>
                      current.map((vendor) =>
                        vendor.id === vendorId ? { ...vendor, stickyNotes } : vendor
                      )
                    );
                  }}
                  organizationId={organizationId}
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
                  onClick={() => selectTab(tab)}
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
                isPlatformAdmin={isPlatformAdmin}
                onChanged={reloadVendors}
              />
            )}
            {activeTab === "contracts" && selectedVendor && (
              <ContractsSection
                vendor={selectedVendor}
                organizationId={organizationId}
                readOnly={readOnly}
                isPlatformAdmin={isPlatformAdmin}
                medianContractValue={medianContractValue}
                draft={getContractDraft(selectedVendor.id)}
                updateContractDraft={updateContractDraft}
                onClearDraft={() => clearContractDraft(selectedVendor.id)}
                extractRequestIdRef={contractExtractRequestIdRef}
                onChanged={reloadVendors}
                onContractSaved={commitSavedContract}
                onSaveMessage={setBannerMessage}
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
                isPlatformAdmin={isPlatformAdmin}
                pendingDocuments={pendingDocumentsByVendor[selectedVendor.id] ?? []}
                onStagePendingDocument={stagePendingDocument}
                onClearPendingDocument={clearPendingDocument}
                onCommitSavedDocument={commitSavedDocument}
                onChanged={reloadVendors}
                onSpendAutoAdded={setBannerMessage}
                onNavigateToSpend={() => selectTab("spend")}
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

function isValidContactEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeContactFields(input: {
  name: string;
  role: string;
  email: string;
  phone: string;
}): Omit<Contact, "id"> | string {
  const name = input.name.trim();
  const role = input.role.trim();
  const email = input.email.trim();
  const phone = input.phone.trim();

  if (!name) return "Name is required.";
  if (!email && !phone) return "Add an email or phone number.";
  if (email && !isValidContactEmail(email)) return "Enter a valid email address.";

  return { name, role, email, phone };
}

function formatContactLine(contact: Contact) {
  const parts = [contact.email.trim() || null, contact.phone.trim() || null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No email or phone yet";
}

function ContactsSection({
  vendor,
  organizationId,
  readOnly,
  isPlatformAdmin,
  onChanged,
}: {
  vendor: Vendor;
  organizationId: string;
  readOnly: boolean;
  isPlatformAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Omit<Contact, "id"> | null>(null);
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  function startEditContact(contact: Contact) {
    setEditingContactId(contact.id);
    setEditDraft({
      name: contact.name,
      role: contact.role,
      email: contact.email,
      phone: contact.phone,
    });
    setEditError("");
  }

  function cancelEditContact() {
    setEditingContactId(null);
    setEditDraft(null);
    setEditError("");
  }

  async function handleAddContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    setAddError("");
    const form = new FormData(event.currentTarget);
    const parsed = normalizeContactFields({
      name: String(form.get("name") || ""),
      role: String(form.get("role") || ""),
      email: String(form.get("email") || ""),
      phone: String(form.get("phone") || ""),
    });
    if (typeof parsed === "string") {
      setAddError(parsed);
      return;
    }

    setAdding(true);
    try {
      await addContact(organizationId, vendor.id, parsed);
      await onChanged();
      event.currentTarget.reset();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Could not add contact.");
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveContactEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || !editDraft || !editingContactId) return;
    setEditError("");

    const parsed = normalizeContactFields(editDraft);
    if (typeof parsed === "string") {
      setEditError(parsed);
      return;
    }

    setEditSaving(true);
    try {
      await updateContact(editingContactId, parsed);
      cancelEditContact();
      await onChanged();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not update contact.");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <>
      <Section title="Contacts" empty={!vendor.contacts.length} emptyText="No contacts added yet.">
        {!readOnly && (
          <>
            <FormGrid onSubmit={handleAddContact} submitText={adding ? "Adding…" : "Add Contact"} disabled={adding}>
              <input name="name" placeholder="Name" required />
              <input name="role" placeholder="Role (optional)" />
              <input name="email" placeholder="Email (optional)" type="email" />
              <input name="phone" placeholder="Phone (optional)" />
            </FormGrid>
            {addError && <p className="form-error">{addError}</p>}
            <p className="muted small">Name plus an email or phone is enough — you can add the other later.</p>
          </>
        )}

        {vendor.contacts.map((contact) => {
          if (editingContactId === contact.id && editDraft) {
            return (
              <form
                key={contact.id}
                className="form-grid card contract-edit-form"
                onSubmit={(event) => void handleSaveContactEdit(event)}
              >
                <p className="muted small contract-edit-form__title">
                  Editing <strong>{contact.name}</strong>
                </p>
                <input
                  name="name"
                  placeholder="Name"
                  required
                  value={editDraft.name}
                  onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })}
                />
                <input
                  name="role"
                  placeholder="Role (optional)"
                  value={editDraft.role}
                  onChange={(event) => setEditDraft({ ...editDraft, role: event.target.value })}
                />
                <input
                  name="email"
                  placeholder="Email (optional)"
                  type="email"
                  value={editDraft.email}
                  onChange={(event) => setEditDraft({ ...editDraft, email: event.target.value })}
                />
                <input
                  name="phone"
                  placeholder="Phone (optional)"
                  value={editDraft.phone}
                  onChange={(event) => setEditDraft({ ...editDraft, phone: event.target.value })}
                />
                {editError && <p className="form-error">{editError}</p>}
                <div className="contract-edit-form__actions">
                  <button type="submit" disabled={editSaving}>
                    {editSaving ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={editSaving}
                    onClick={cancelEditContact}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            );
          }

          return (
            <div className="card row" key={contact.id}>
              <div>
                <strong>{contact.name}</strong>
                {contact.role.trim() ? <p className="muted">{contact.role}</p> : null}
                <p className="muted">{formatContactLine(contact)}</p>
              </div>
              {!readOnly && (
                <div className="right-actions">
                  <button type="button" className="secondary" onClick={() => startEditContact(contact)}>
                    Edit
                  </button>
                  <DeleteButton
                    onClick={async () => {
                      if (editingContactId === contact.id) cancelEditContact();
                      await deleteContact(contact.id);
                      await onChanged();
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <VendorContactEmailPanel
        organizationId={organizationId}
        vendorId={vendor.id}
        contacts={vendor.contacts}
        readOnly={readOnly}
        isPlatformAdmin={isPlatformAdmin}
      />
    </>
  );
}

function ContractCoreFields({
  draft,
  patchDraft,
  onSuggestReviewDate,
  idPrefix = "",
}: {
  draft: ContractFormDraft;
  patchDraft: (patch: Partial<ContractFormDraft>) => void;
  onSuggestReviewDate: () => void;
  idPrefix?: string;
}) {
  const renewalTypeHint =
    RENEWAL_TYPE_OPTIONS.find((option) => option.value === draft.renewalType)?.hint ?? "";
  const showEndDate = draft.renewalType === "fixed_term" || draft.renewalType === "auto_renew";
  const showReviewDate =
    draft.renewalType === "auto_renew" ||
    draft.renewalType === "month_to_month" ||
    draft.renewalType === "evergreen";
  const showNoticePeriod = draft.renewalType === "auto_renew";
  const showTermMonths =
    draft.renewalType === "auto_renew" || draft.renewalType === "month_to_month";
  const fieldId = (name: string) => (idPrefix ? `${idPrefix}-${name}` : name);

  return (
    <>
      <input
        id={fieldId("name")}
        name="name"
        placeholder="Contract name"
        value={draft.name}
        onChange={(event) => patchDraft({ name: event.target.value })}
      />
      <label className="field-block" htmlFor={fieldId("startDate")}>
        <span className="label">{CONTRACT_START_LABEL}</span>
        <input
          id={fieldId("startDate")}
          name="startDate"
          required
          type="date"
          value={draft.startDate}
          onChange={(event) => patchDraft({ startDate: event.target.value })}
        />
        <span className="muted small">{CONTRACT_START_HINT}</span>
      </label>
      <label className="field-block" htmlFor={fieldId("renewalType")}>
        <span className="label">Renewal type</span>
        <select
          id={fieldId("renewalType")}
          name="renewalType"
          value={draft.renewalType}
          onChange={(event) =>
            patchDraft({ renewalType: event.target.value as ContractRenewalType })
          }
        >
          {RENEWAL_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {renewalTypeHint && <span className="muted small">{renewalTypeHint}</span>}
      </label>
      {showTermMonths && (
        <label className="field-block" htmlFor={fieldId("termMonths")}>
          <span className="label">Term length (months)</span>
          <input
            id={fieldId("termMonths")}
            name="termMonths"
            min={1}
            placeholder="e.g. 12"
            type="number"
            value={draft.termMonths}
            onChange={(event) => patchDraft({ termMonths: event.target.value })}
          />
          <span className="muted small">Optional — helps compute review dates from the start date.</span>
        </label>
      )}
      {showNoticePeriod && (
        <label className="field-block" htmlFor={fieldId("noticePeriodDays")}>
          <span className="label">Notice period (days)</span>
          <input
            id={fieldId("noticePeriodDays")}
            name="noticePeriodDays"
            min={0}
            placeholder="e.g. 90"
            type="number"
            value={draft.noticePeriodDays}
            onChange={(event) => patchDraft({ noticePeriodDays: event.target.value })}
          />
          <span className="muted small">
            Days before renewal you must give notice to cancel or renegotiate.
          </span>
        </label>
      )}
      {showEndDate && (
        <label className="field-block" htmlFor={fieldId("endDate")}>
          <span className="label">
            {draft.renewalType === "auto_renew" ? "Current term end (optional)" : CONTRACT_END_LABEL}
          </span>
          <input
            id={fieldId("endDate")}
            name="endDate"
            required={draft.renewalType === "fixed_term"}
            type="date"
            value={draft.endDate}
            onChange={(event) => patchDraft({ endDate: event.target.value })}
          />
          <span className="muted small">
            {draft.renewalType === "auto_renew"
              ? "If known — used with notice period to suggest a review date."
              : CONTRACT_END_HINT}
          </span>
        </label>
      )}
      {showReviewDate && (
        <label className="field-block" htmlFor={fieldId("renewalDate")}>
          <span className="label">{CONTRACT_REVIEW_LABEL}</span>
          <div className="field-inline">
            <input
              id={fieldId("renewalDate")}
              name="renewalDate"
              required={draft.renewalType === "month_to_month"}
              type="date"
              value={draft.renewalDate}
              onChange={(event) => patchDraft({ renewalDate: event.target.value })}
            />
            {draft.startDate && draft.termMonths && (
              <button className="secondary" onClick={onSuggestReviewDate} type="button">
                Suggest from term
              </button>
            )}
          </div>
          <span className="muted small">{CONTRACT_REVIEW_HINT}</span>
        </label>
      )}
      <input
        id={fieldId("value")}
        name="value"
        placeholder="Value"
        type="number"
        value={draft.value}
        onChange={(event) => patchDraft({ value: event.target.value })}
      />
      <select
        id={fieldId("status")}
        name="status"
        value={draft.status}
        onChange={(event) => patchDraft({ status: event.target.value as Status })}
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="pending">Pending</option>
        <option value="expired">Expired</option>
      </select>
    </>
  );
}

function ContractExtractSetupHint({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  if (!isPlatformAdmin) {
    return <>{CLINIC_EXTRACT_UNAVAILABLE}</>;
  }

  return (
    <>
      AI extraction is not configured. Add <code>OPENAI_API_KEY</code> in{" "}
      <a href={getSupabaseEdgeSecretsUrl()} target="_blank" rel="noreferrer">
        Supabase Edge Function secrets
      </a>{" "}
      (or run <code>./scripts/setup-contract-extract.sh</code>).
    </>
  );
}

function ContractsSection({
  vendor,
  organizationId,
  readOnly,
  isPlatformAdmin,
  medianContractValue,
  draft,
  updateContractDraft,
  onClearDraft,
  extractRequestIdRef,
  onChanged,
  onContractSaved,
  onSaveMessage,
}: {
  vendor: Vendor;
  organizationId: string;
  readOnly: boolean;
  isPlatformAdmin: boolean;
  medianContractValue: number;
  draft: ContractFormDraft;
  updateContractDraft: (vendorId: string, patch: Partial<ContractFormDraft>) => void;
  onClearDraft: () => void;
  extractRequestIdRef: React.MutableRefObject<Record<string, number>>;
  onChanged: () => Promise<void>;
  onContractSaved: (vendorId: string, contract: Contract) => void;
  onSaveMessage: (message: string) => void;
}) {
  const patchDraft = useCallback(
    (patch: Partial<ContractFormDraft>) => updateContractDraft(vendor.id, patch),
    [updateContractDraft, vendor.id]
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [formError, setFormError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ContractFormDraft | null>(null);
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [viewingFile, setViewingFile] = useState<FileAttachment | null>(null);
  const [extractConfigured, setExtractConfigured] = useState<boolean | null>(null);
  const [extractReachable, setExtractReachable] = useState(true);
  const [lifecycleFilter, setLifecycleFilter] = useState<ItemLifecycleFilter>("all");
  const [viewedTick, setViewedTick] = useState(0);
  const [handlingContractId, setHandlingContractId] = useState<string | null>(null);
  const viewedIds = useMemo(
    () => loadViewedIds(organizationId, "contracts"),
    [organizationId, viewedTick]
  );

  const lifecycleCounts = useMemo(() => {
    const counts = { all: vendor.contracts.length, new: 0, active: 0, expired: 0 };
    for (const contract of vendor.contracts) {
      counts[classifyContract(contract, viewedIds)] += 1;
    }
    return counts;
  }, [vendor.contracts, viewedIds]);

  const displayedContracts = useMemo(() => {
    return vendor.contracts
      .filter((contract) =>
        matchesLifecycleFilter(classifyContract(contract, viewedIds), lifecycleFilter)
      )
      .sort((a, b) => lifecycleSortDate("contract", b).localeCompare(lifecycleSortDate("contract", a)));
  }, [vendor.contracts, lifecycleFilter, viewedIds]);

  function acknowledgeContract(contractId: string) {
    markViewed(organizationId, "contracts", contractId);
    setViewedTick((tick) => tick + 1);
  }

  function contractInRenewalWindow(contract: Contract): boolean {
    if (contract.status === "inactive") return false;
    if (contract.renewalHandledAt) return false;
    if (isContractOverdue(contract) || contract.status === "expired") return true;
    const urgencyDate = getContractUrgencyDate(contract);
    if (!urgencyDate) return false;
    const days = daysUntilEnd(urgencyDate);
    if (!Number.isFinite(days)) return false;
    return isInOpenRenewalsWindow(days);
  }

  async function handleMarkContractRenewalHandled(contractId: string) {
    setHandlingContractId(contractId);
    setFormError("");
    try {
      await setRenewalHandled(contractId, true);
      await onChanged();
      onSaveMessage("Renewal marked as handled.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not mark renewal handled.");
    } finally {
      setHandlingContractId(null);
    }
  }

  useEffect(() => {
    return () => revokeAttachmentUrl(viewingFile);
  }, [viewingFile]);

  useEffect(() => {
    let cancelled = false;
    fetchContractExtractStatus()
      .then((status) => {
        if (cancelled) return;
        setExtractConfigured(status.configured);
        setExtractReachable(status.reachable !== false);
        if (!status.reachable && status.error) {
          patchDraft({ extractError: status.error });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExtractConfigured(null);
          setExtractReachable(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // Status probe runs once per vendor workspace mount; draft updates use the latest callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor.id]);

  async function runContractExtraction(file: File) {
    if (readOnly) {
      patchDraft({
        extractError: "You do not have permission to edit contracts in this workspace.",
        extractNotice: "",
      });
      return;
    }

    if (!isPdfFile(file)) {
      patchDraft({
        extractError: "Only PDF files can be read by AI. Attach a PDF or enter details manually.",
        extractNotice: "",
      });
      return;
    }

    if (!acknowledgeAiDisclosureIfNeeded()) return;

    const requestId = (extractRequestIdRef.current[vendor.id] ?? 0) + 1;
    extractRequestIdRef.current[vendor.id] = requestId;
    patchDraft({ extracting: true, extractError: "", extractNotice: "" });

    try {
      const result = await extractContractFromPdf(organizationId, file);
      if (requestId !== extractRequestIdRef.current[vendor.id]) return;

      setExtractConfigured(result.configured);
      setExtractReachable(true);

      if (!result.configured) {
        patchDraft({
          extracting: false,
          extractError: isPlatformAdmin
            ? result.error ??
              "AI extraction is not configured. Add OPENAI_API_KEY to Supabase Edge Function secrets."
            : CLINIC_EXTRACT_UNAVAILABLE,
        });
        return;
      }

      if (result.error) {
        patchDraft({ extracting: false, extractError: result.error });
        return;
      }

      const currentDraft = draftRef.current;
      const enriched = enrichContractExtractResult(result);
      const extractPatch = applyContractExtractToDraft(currentDraft, enriched);
      const draftAfter = { ...currentDraft, ...extractPatch };
      patchDraft({
        ...extractPatch,
        extracting: false,
        extractNotice: buildContractExtractNotice(enriched, draftAfter),
      });
    } catch (error) {
      if (requestId !== extractRequestIdRef.current[vendor.id]) return;
      patchDraft({
        extracting: false,
        extractError: error instanceof Error ? error.message : "Could not read document.",
      });
    }
  }

  function handleContractFileSelected(files: File[]) {
    const file = files[0] ?? null;
    patchDraft({ file, extractError: "", extractNotice: "", extracting: false });
    if (file && isPdfFile(file)) {
      void runContractExtraction(file);
    }
  }

  function closeFileViewer() {
    setViewingFile((current) => {
      revokeAttachmentUrl(current);
      return null;
    });
  }

  function previewAttachment(attachment: FileAttachment) {
    if (getFilePreviewKind(attachment.fileName, attachment.mimeType) === "pdf") {
      holdFilePreviewTab(attachment.fileUrl, attachment.fileName);
    }
    setViewingFile((current) => {
      revokeAttachmentUrl(current);
      return attachment;
    });
  }

  function previewLocalFile(file: File) {
    previewAttachment(localFileToAttachment(file));
  }

  function removeAttachedFile() {
    extractRequestIdRef.current[vendor.id] = (extractRequestIdRef.current[vendor.id] ?? 0) + 1;
    patchDraft({
      file: null,
      extractError: "",
      extractNotice: "",
      extracting: false,
    });
  }

  async function handleAddContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    setFormError("");
    setSaveSuccess("");

    if (!organizationId) {
      setFormError("No workspace selected. Refresh the page and try again.");
      return;
    }

    const contract: Omit<Contract, "id"> = buildContractPayload(draft);
    const validationError = validateContractDates(contract);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      if (draft.file) {
        if (draft.file.size > MAX_FILE_BYTES) {
          throw new Error(
            `"${draft.file.name}" is ${formatFileSize(draft.file.size)}. Maximum ${formatFileSize(MAX_FILE_BYTES)} per file.`
          );
        }
        const uploaded = await uploadOrgFile(organizationId, vendor.id, draft.file);
        uploadedPath = uploaded.path;
        contract.file = {
          fileName: draft.file.name,
          fileSize: draft.file.size,
          fileUrl: uploaded.fileUrl,
          mimeType: draft.file.type || "application/octet-stream",
        };
      }
      const saved = await addContract(organizationId, vendor.id, contract);
      onContractSaved(vendor.id, saved);
      await onChanged();
      onClearDraft();
      const message = `"${saved.name}" saved.`;
      setSaveSuccess(message);
      onSaveMessage(message);
    } catch (error) {
      if (uploadedPath) {
        await rollbackOrgUpload(uploadedPath);
      }
      setFormError(error instanceof Error ? error.message : "Could not save contract.");
    } finally {
      setSaving(false);
    }
  }

  function startEditContract(contract: Contract) {
    setEditingContractId(contract.id);
    setEditDraft(contractToDraft(contract));
    setEditError("");
  }

  function cancelEditContract() {
    setEditingContractId(null);
    setEditDraft(null);
    setEditError("");
  }

  function patchEditDraft(patch: Partial<ContractFormDraft>) {
    setEditDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function suggestDraftReviewDate(target: ContractFormDraft, patch: (next: Partial<ContractFormDraft>) => void) {
    if (!target.startDate || !target.termMonths) return;
    patch({
      renewalDate: computeSuggestedReviewDate({
        startDate: target.startDate,
        termMonths: Number(target.termMonths),
        noticePeriodDays: target.noticePeriodDays ? Number(target.noticePeriodDays) : null,
      }),
    });
  }

  async function handleSaveContractEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || !editDraft || !editingContractId) return;
    setEditError("");

    const contract = buildContractPayload(editDraft);
    const validationError = validateContractDates(contract);
    if (validationError) {
      setEditError(validationError);
      return;
    }

    setEditSaving(true);
    try {
      const saved = await updateContract(editingContractId, contract);
      onContractSaved(vendor.id, saved);
      cancelEditContract();
      onSaveMessage(`Updated contract "${saved.name}".`);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not update contract.");
    } finally {
      setEditSaving(false);
    }
  }

  function suggestReviewDate() {
    suggestDraftReviewDate(draft, patchDraft);
  }

  function suggestEditReviewDate() {
    if (!editDraft) return;
    suggestDraftReviewDate(editDraft, patchEditDraft);
  }

  return (
    <Section title="Contracts" empty={!vendor.contracts.length} emptyText="No contracts added yet.">
      {!readOnly && (
        <>
          <div className="notice">
            Attach a contract PDF and click <strong>Scan with AI</strong> to auto-fill name, dates, value, and document
            type (PDFs also scan automatically on upload). Word and other formats can be attached but must be entered
            manually. Nothing is saved until you click <strong>Add Contract</strong> (files are stored securely, up to{" "}
            {formatFileSize(MAX_FILE_BYTES)} each).
          </div>
          <FormGrid
            onSubmit={handleAddContract}
            submitText={saving ? "Saving…" : "Add Contract"}
            disabled={saving || draft.extracting}
          >
            <ContractCoreFields
              draft={draft}
              patchDraft={patchDraft}
              onSuggestReviewDate={suggestReviewDate}
            />
            <FileDropZone
              multiple={false}
              disabled={saving || draft.extracting}
              hint="Attach a PDF to scan with AI · Word and other formats can be saved without auto-fill"
              onFiles={handleContractFileSelected}
            />
            {draft.file && (
              <>
                <p className="selected-file">
                  <span>Attached:</span>
                  <button
                    type="button"
                    className="doc-title-button"
                    onClick={() => previewLocalFile(draft.file!)}
                  >
                    {draft.file.name}
                  </button>
                  <span className="muted small">({formatFileSize(draft.file.size)})</span>
                  <button
                    type="button"
                    className="secondary doc-view-button"
                    onClick={() => previewLocalFile(draft.file!)}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="secondary doc-view-button"
                    disabled={draft.extracting || !isPdfFile(draft.file)}
                    title={
                      isPdfFile(draft.file)
                        ? "Read contract name, dates, and value from the PDF"
                        : "Export this file to PDF to use AI scanning"
                    }
                    onClick={() => void runContractExtraction(draft.file!)}
                  >
                    {draft.extracting ? "Reading…" : "Scan with AI"}
                  </button>
                  <button type="button" className="text-button" onClick={removeAttachedFile}>
                    Remove
                  </button>
                </p>
                {!isPdfFile(draft.file) && (
                  <div className="contract-extract-status contract-extract-status--info" role="status">
                    <p className="contract-extract-status__message">{NON_PDF_CONTRACT_EXTRACT_MESSAGE}</p>
                  </div>
                )}
                <p className="notice contract-draft-notice">
                  The attached file is not saved yet. Fill in contract name and dates, then click{" "}
                  <strong>Add Contract</strong>.
                </p>
              </>
            )}
            {(draft.extracting || draft.extractError || draft.extractNotice) && (
              <div
                className={`contract-extract-status${draft.extractError ? " contract-extract-status--error" : ""}${
                  draft.extracting ? " contract-extract-status--loading" : ""
                }`}
                role="status"
                aria-live="polite"
              >
                {draft.extracting && <p className="contract-extract-status__message">Reading document with AI…</p>}
                {!draft.extracting && draft.extractError && (
                  <p className="contract-extract-status__message">
                    {isAdminExtractError(draft.extractError) ? (
                      <ContractExtractSetupHint isPlatformAdmin={isPlatformAdmin} />
                    ) : (
                      draft.extractError
                    )}
                  </p>
                )}
                {!draft.extracting && draft.extractNotice && !draft.extractError && (
                  <p className="contract-extract-status__message">{draft.extractNotice}</p>
                )}
              </div>
            )}
            {extractConfigured === false && extractReachable && !draft.file && !draft.extractError && (
              <div className="contract-extract-status contract-extract-status--error" role="status">
                <p className="contract-extract-status__message">
                  <ContractExtractSetupHint isPlatformAdmin={isPlatformAdmin} />
                </p>
              </div>
            )}
            {!extractReachable && !draft.extractError && (
              <div className="contract-extract-status contract-extract-status--error" role="status">
                <p className="contract-extract-status__message">
                  {isPlatformAdmin
                    ? "Could not reach the AI extraction service. Confirm the extract-contract edge function is deployed."
                    : CLINIC_EXTRACT_UNAVAILABLE}
                </p>
              </div>
            )}
          </FormGrid>
        </>
      )}
      {saveSuccess && <p className="notice">{saveSuccess}</p>}
      {formError && (
        <p className="form-error">
          {formError}
          {isPlatformAdmin &&
            (formError.toLowerCase().includes("storage") ||
              formError.toLowerCase().includes("bucket") ||
              formError.toLowerCase().includes("polic")) && (
              <>
                {" "}
                <a href={getSupabaseSqlEditorUrl()} target="_blank" rel="noreferrer">
                  Open SQL Editor (storage setup)
                </a>
              </>
            )}
        </p>
      )}

      {vendor.contracts.length > 0 && (
        <ItemFilterChips
          value={lifecycleFilter}
          onChange={setLifecycleFilter}
          options={[
            { value: "all", label: "All", count: lifecycleCounts.all },
            { value: "new", label: "New", count: lifecycleCounts.new },
            { value: "active", label: "Active", count: lifecycleCounts.active },
            { value: "expired", label: "Expired", count: lifecycleCounts.expired },
          ]}
        />
      )}

      {displayedContracts.map((contract) => {
        const lifecycle = classifyContract(contract, viewedIds);
        if (editingContractId === contract.id && editDraft) {
          return (
            <form
              key={contract.id}
              className="form-grid card contract-edit-form"
              onSubmit={(event) => void handleSaveContractEdit(event)}
            >
              <p className="muted small contract-edit-form__title">
                Editing <strong>{contract.name}</strong>
              </p>
              <ContractCoreFields
                draft={editDraft}
                patchDraft={patchEditDraft}
                onSuggestReviewDate={suggestEditReviewDate}
                idPrefix={`edit-${contract.id}`}
              />
              {editError && <p className="form-error">{editError}</p>}
              <div className="contract-edit-form__actions">
                <button type="submit" disabled={editSaving}>
                  {editSaving ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={editSaving}
                  onClick={cancelEditContract}
                >
                  Cancel
                </button>
              </div>
            </form>
          );
        }

        return (
        <div className="card row" key={contract.id}>
          <div>
            <div className="row-title-with-badge">
              <strong>{contract.name}</strong>
              {lifecycle !== "active" && <LifecycleBadge lifecycle={lifecycle} />}
              {contract.renewalHandledAt && <span className="badge active">Renewal handled</span>}
            </div>
            <p className="muted small">
              {renewalTypeLabel(contract.renewalType)}
              {contract.renewalType !== "fixed_term" && contract.renewalDate
                ? ` · ${CONTRACT_REVIEW_LABEL}: ${prettyDate(contract.renewalDate)}`
                : ""}
            </p>
            <p className="muted small">
              {CONTRACT_START_LABEL}: {prettyDate(contract.startDate)}
              {contract.endDate ? (
                <>
                  <br />
                  {CONTRACT_END_LABEL}: {prettyDate(contract.endDate)}
                </>
              ) : contract.renewalType !== "fixed_term" ? (
                <>
                  <br />
                  No fixed end date
                </>
              ) : null}
              {contract.noticePeriodDays ? (
                <>
                  <br />
                  {contract.noticePeriodDays}-day notice period
                </>
              ) : null}
              {contract.termMonths ? (
                <>
                  <br />
                  {contract.termMonths}-month term
                </>
              ) : null}
            </p>
            <p>{money(contract.value)}</p>
            {contract.file && (
              <div className="file-meta">
                <FileAttachmentLink
                  fileUrl={contract.file.fileUrl}
                  fileName={contract.file.fileName}
                  fileSize={contract.file.fileSize}
                  onPreview={() => previewAttachment(contract.file!)}
                />
                <button
                  type="button"
                  className="secondary doc-view-button"
                  onClick={() => {
                    acknowledgeContract(contract.id);
                    previewAttachment(contract.file!);
                  }}
                >
                  View
                </button>
              </div>
            )}
          </div>
          <div className="right-actions">
            <ContractRenewalLossBadge
              contract={contract}
              medianContractValue={medianContractValue}
              vendor={vendor}
            />
            <span className={getStatusClass(contract.status)}>{contract.status}</span>
            {!readOnly && !contract.renewalHandledAt && contractInRenewalWindow(contract) && (
              <button
                type="button"
                className="secondary"
                disabled={handlingContractId === contract.id}
                onClick={() => void handleMarkContractRenewalHandled(contract.id)}
              >
                {handlingContractId === contract.id ? "Saving…" : "Mark renewal handled"}
              </button>
            )}
            {!readOnly && (
              <>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => startEditContract(contract)}
                >
                  Edit
                </button>
                <DeleteButton
                  onClick={async () => {
                    if (editingContractId === contract.id) cancelEditContract();
                    await deleteContract(contract.id);
                    await onChanged();
                  }}
                />
              </>
            )}
          </div>
        </div>
        );
      })}
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

function buildDocumentExtractNotice(
  fileName: string,
  result: DocumentExtractResult,
  mappedDocType: DocumentDocType,
  spendAdded = false
): string {
  const typeLabel =
    result.documentTypeLabel ??
    extractDocumentTypeLabel(result.documentType) ??
    complianceLabel(mappedDocType);
  const mappedLabel = complianceLabel(mappedDocType);
  const typeNote =
    typeLabel !== mappedLabel ? ` (saved as ${mappedLabel})` : "";

  if (isSpendDocumentType(result.documentType) || buildSpendPrefill(result, fileName)) {
    return spendAdded
      ? `"${fileName}" — detected ${typeLabel}${typeNote}. Spend entry added — see Spend tab.`
      : `"${fileName}" — detected ${typeLabel}${typeNote}. Review spend details below.`;
  }
  if (isMemoDocumentType(result.documentType) && result.summary) {
    return `"${fileName}" — ${typeLabel}${typeNote}. Summary saved below.`;
  }
  if (isContractLikeDocumentType(result.documentType)) {
    return `"${fileName}" — detected ${typeLabel}. Add contract details on the Contracts tab if needed.`;
  }
  return `"${fileName}" — detected ${typeLabel}${typeNote}.`;
}

type SpendPrefillState = SpendPrefill;

function DocumentsSection({
  vendor,
  organizationId,
  readOnly,
  isPlatformAdmin,
  pendingDocuments,
  onStagePendingDocument,
  onClearPendingDocument,
  onCommitSavedDocument,
  onChanged,
  onSpendAutoAdded,
  onNavigateToSpend,
}: {
  vendor: Vendor;
  organizationId: string;
  readOnly: boolean;
  isPlatformAdmin: boolean;
  pendingDocuments: DocumentItem[];
  onStagePendingDocument: (vendorId: string, document: DocumentItem) => void;
  onClearPendingDocument: (vendorId: string, documentId: string) => void;
  onCommitSavedDocument: (vendorId: string, pendingId: string, document: DocumentItem) => void;
  onChanged: () => Promise<void>;
  onSpendAutoAdded?: (message: string) => void;
  onNavigateToSpend?: () => void;
}) {
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [docType, setDocType] = useState<DocumentDocType>("general");
  const [expiresAt, setExpiresAt] = useState("");
  const [viewingDocument, setViewingDocument] = useState<DocumentItem | null>(null);
  const [documentSummaries, setDocumentSummaries] = useState<Record<string, string>>({});
  const [spendPrefill, setSpendPrefill] = useState<SpendPrefillState | null>(null);
  const [addingSpend, setAddingSpend] = useState(false);
  const [readingDocId, setReadingDocId] = useState<string | null>(null);
  const [readResult, setReadResult] = useState<{ documentId: string; result: DocumentExtractResult } | null>(
    null
  );
  const [lifecycleFilter, setLifecycleFilter] = useState<ItemLifecycleFilter>("all");
  const [viewedTick, setViewedTick] = useState(0);
  const viewedIds = useMemo(
    () => loadViewedIds(organizationId, "documents"),
    [organizationId, viewedTick]
  );
  const visibleDocuments = useMemo(
    () => mergePendingDocuments(vendor.documents, pendingDocuments),
    [vendor.documents, pendingDocuments]
  );

  const lifecycleCounts = useMemo(() => {
    const counts = { all: visibleDocuments.length, new: 0, active: 0, expired: 0 };
    for (const document of visibleDocuments) {
      if (document.id.startsWith("pending-")) continue;
      counts[classifyDocument(document, viewedIds)] += 1;
    }
    return counts;
  }, [visibleDocuments, viewedIds]);

  const displayedDocuments = useMemo(() => {
    return visibleDocuments
      .filter((document) => {
        if (document.id.startsWith("pending-")) return lifecycleFilter === "all" || lifecycleFilter === "new";
        return matchesLifecycleFilter(classifyDocument(document, viewedIds), lifecycleFilter);
      })
      .sort((a, b) => lifecycleSortDate("document", b).localeCompare(lifecycleSortDate("document", a)));
  }, [visibleDocuments, lifecycleFilter, viewedIds]);

  function openDocument(document: DocumentItem) {
    if (!document.id.startsWith("pending-")) {
      markViewed(organizationId, "documents", document.id);
      setViewedTick((tick) => tick + 1);
    }
    if (getFilePreviewKind(document.fileName) === "pdf") {
      holdFilePreviewTab(document.fileUrl, document.fileName);
    }
    setViewingDocument(document);
  }

  async function addSpendFromPrefill(
    prefill: SpendPrefillState,
    options?: { auto?: boolean; navigateToSpend?: boolean }
  ): Promise<boolean> {
    if (readOnly) return false;

    setAddingSpend(true);
    setExtractError("");
    try {
      await addLedgerEntry(organizationId, vendor.id, {
        date: prefill.date,
        description: prefill.description,
        amount: Number(prefill.amount),
        type: "payment",
        source: "manual",
      });
      await onChanged();
      setSpendPrefill(null);
      const message = options?.auto
        ? `Added ${money(Number(prefill.amount))} to Spend from "${prefill.sourceFileName}".`
        : `Added spend entry from "${prefill.sourceFileName}".`;
      setUploadSuccess(message);
      onSpendAutoAdded?.(message);
      if (options?.auto && (options.navigateToSpend ?? true)) {
        onNavigateToSpend?.();
      }
      return true;
    } catch (error) {
      setSpendPrefill(prefill);
      setExtractError(error instanceof Error ? error.message : "Could not add spend entry.");
      return false;
    } finally {
      setAddingSpend(false);
    }
  }

  async function applyDocumentExtract(fileName: string, result: DocumentExtractResult) {
    let fileDocType = docType;
    let fileExpiresAt = expiresAt || undefined;
    let summary: string | undefined;

    if (result.documentType) {
      fileDocType = mapExtractDocumentTypeToDocType(result.documentType);
      setDocType(fileDocType);
    }
    if (result.endDate) {
      fileExpiresAt = result.endDate;
      setExpiresAt(result.endDate);
    }

    if (result.summary) {
      summary = result.summary;
    }

    const spendPrefill = buildSpendPrefill(result, fileName, vendor.name) ?? undefined;
    return { fileDocType, fileExpiresAt, summary, spendPrefill };
  }

  async function uploadFiles(files: File[]) {
    if (!files.length || readOnly) return;

    setUploading(true);
    setUploadError("");
    setUploadSuccess("");
    setExtractError("");

    const saved: string[] = [];
    const extractNotes: string[] = [];
    let navigateToSpendAfterBatch = false;
    try {
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(
            `"${file.name}" is ${formatFileSize(file.size)}. Maximum ${formatFileSize(MAX_FILE_BYTES)} per file.`
          );
        }

        let fileDocType = docType;
        let fileExpiresAt = expiresAt || undefined;

        if (isPdfFile(file)) {
          if (!acknowledgeAiDisclosureIfNeeded()) {
            setExtracting(false);
            continue;
          }
          setExtracting(true);
          try {
            const result = await extractDocumentFromPdf(organizationId, file);
            if (result.configured && !result.error) {
              const applied = await applyDocumentExtract(file.name, result);
              fileDocType = applied.fileDocType;
              fileExpiresAt = applied.fileExpiresAt;

              const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              onStagePendingDocument(vendor.id, {
                id: pendingId,
                fileName: file.name,
                fileSize: file.size,
                createdAt: new Date().toISOString().slice(0, 10),
                fileUrl: "",
                docType: fileDocType,
                expiresAt: fileExpiresAt,
              });

              try {
                const document = await uploadAndAddDocument(organizationId, vendor.id, file, {
                  docType: fileDocType,
                  expiresAt: fileExpiresAt,
                });
                onCommitSavedDocument(vendor.id, pendingId, document);

                if (applied.summary) {
                  setDocumentSummaries((current) => ({ ...current, [document.id]: applied.summary! }));
                }

                let spendAdded = false;
                if (applied.spendPrefill) {
                  spendAdded = await addSpendFromPrefill(applied.spendPrefill, {
                    auto: true,
                    navigateToSpend: false,
                  });
                  if (spendAdded) navigateToSpendAfterBatch = true;
                }

                if (result.documentType || result.documentTypeLabel || result.summary) {
                  extractNotes.push(
                    buildDocumentExtractNotice(file.name, result, fileDocType, spendAdded)
                  );
                }

                saved.push(file.name);
              } catch (error) {
                onClearPendingDocument(vendor.id, pendingId);
                throw error;
              }
              continue;
            } else if (!result.configured) {
              setExtractError(
                isPlatformAdmin
                  ? result.error ?? CLINIC_DOCUMENT_EXTRACT_UNAVAILABLE
                  : CLINIC_DOCUMENT_EXTRACT_UNAVAILABLE
              );
            } else if (result.error) {
              setExtractError(result.error);
            }
          } catch (error) {
            setExtractError(error instanceof Error ? error.message : "Could not read document.");
          } finally {
            setExtracting(false);
          }
        }

        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        onStagePendingDocument(vendor.id, {
          id: pendingId,
          fileName: file.name,
          fileSize: file.size,
          createdAt: new Date().toISOString().slice(0, 10),
          fileUrl: "",
          docType: fileDocType,
          expiresAt: fileExpiresAt,
        });

        try {
          const document = await uploadAndAddDocument(organizationId, vendor.id, file, {
            docType: fileDocType,
            expiresAt: fileExpiresAt,
          });
          onCommitSavedDocument(vendor.id, pendingId, document);
          saved.push(file.name);
        } catch (error) {
          onClearPendingDocument(vendor.id, pendingId);
          throw error;
        }
      }
      await onChanged();
      setExpiresAt("");
      if (navigateToSpendAfterBatch) {
        onNavigateToSpend?.();
      }
      const savedMessage =
        saved.length === 1 ? `"${saved[0]}" saved.` : `${saved.length} documents saved.`;
      if (extractNotes.length > 0) {
        setUploadSuccess(`${savedMessage} ${extractNotes.join(" ")}`);
      } else {
        setUploadSuccess(savedMessage);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      if (saved.length > 0) {
        setUploadError(`${message} (${saved.length} file${saved.length === 1 ? "" : "s"} saved before this error.)`);
        await onChanged();
      } else {
        setUploadError(message);
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleReadDocument(document: DocumentItem) {
    if (readOnly || !hasDownloadableFile(document.fileUrl)) return;
    if (!document.fileName.toLowerCase().endsWith(".pdf")) {
      setExtractError("Only PDF files can be read by AI.");
      return;
    }

    if (!acknowledgeAiDisclosureIfNeeded()) return;

    setReadingDocId(document.id);
    setExtractError("");
    setReadResult(null);

    try {
      const result = await extractDocumentFromUrl(organizationId, document.fileUrl, document.fileName);
      if (!result.configured) {
        setExtractError(
          isPlatformAdmin
            ? result.error ?? CLINIC_DOCUMENT_EXTRACT_UNAVAILABLE
            : CLINIC_DOCUMENT_EXTRACT_UNAVAILABLE
        );
        return;
      }
      if (result.error) {
        setExtractError(result.error);
        return;
      }

      setReadResult({ documentId: document.id, result });

      if (result.summary) {
        setDocumentSummaries((current) => ({ ...current, [document.id]: result.summary! }));
      }

      const prefill = buildSpendPrefill(result, document.fileName, vendor.name);
      if (prefill) {
        setSpendPrefill(prefill);
      }
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : "Could not read document.");
    } finally {
      setReadingDocId(null);
    }
  }

  async function handleAddSpendFromExtract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || !spendPrefill) return;
    await addSpendFromPrefill(spendPrefill);
  }

  return (
    <Section title="Documents" empty={!visibleDocuments.length} emptyText="No documents uploaded yet.">
      {!readOnly && (
        <>
          <div className="notice">
            Upload PDFs, Word docs, spreadsheets, or images. PDF invoices and receipts are read with AI and
            added to Spend automatically. Memos show a summary; compliance docs suggest type and expiry. Tag COI
            and W-9 for tracking.
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
              disabled={uploading || extracting}
              hint={`Up to ${formatFileSize(MAX_FILE_BYTES)} per file · PDFs auto-read with AI`}
              onFiles={uploadFiles}
            />
            {(uploading || extracting) && (
              <p className="muted">{extracting ? "Reading PDF with AI…" : "Uploading…"}</p>
            )}
            {uploadSuccess && <p className="notice">{uploadSuccess}</p>}
            {(uploadError || extractError) && (
              <p className="form-error">
                {uploadError || extractError}
                {isPlatformAdmin &&
                  uploadError &&
                  (uploadError.includes("Step B") || uploadError.toLowerCase().includes("polic")) && (
                    <>
                      {" "}
                      <a href={getSupabaseSqlEditorUrl()} target="_blank" rel="noreferrer">
                        Open SQL Editor (Step B)
                      </a>
                    </>
                  )}
              </p>
            )}
          </div>

          {spendPrefill && (
            <div className="card highlight spend-prefill-card">
              <p className="label">Could not auto-add spend — review and save</p>
              <p className="muted small">
                Detected receipt or invoice from &ldquo;{spendPrefill.sourceFileName}&rdquo;. Confirm details
                below to add to Spend.
              </p>
              <FormGrid
                onSubmit={handleAddSpendFromExtract}
                submitText={addingSpend ? "Adding…" : "Add to Spend"}
                disabled={addingSpend}
              >
                <input
                  name="date"
                  type="date"
                  required
                  value={spendPrefill.date}
                  onChange={(event) =>
                    setSpendPrefill((current) =>
                      current ? { ...current, date: event.target.value } : current
                    )
                  }
                />
                <input
                  name="description"
                  placeholder="Description"
                  required
                  value={spendPrefill.description}
                  onChange={(event) =>
                    setSpendPrefill((current) =>
                      current ? { ...current, description: event.target.value } : current
                    )
                  }
                />
                <input
                  name="amount"
                  placeholder="Amount"
                  type="number"
                  step="0.01"
                  required
                  value={spendPrefill.amount}
                  onChange={(event) =>
                    setSpendPrefill((current) =>
                      current ? { ...current, amount: event.target.value } : current
                    )
                  }
                />
              </FormGrid>
              <button type="button" className="secondary" onClick={() => setSpendPrefill(null)}>
                Dismiss
              </button>
            </div>
          )}
        </>
      )}

      {visibleDocuments.length > 0 && (
        <ItemFilterChips
          value={lifecycleFilter}
          onChange={setLifecycleFilter}
          options={[
            { value: "all", label: "All", count: lifecycleCounts.all },
            { value: "new", label: "New", count: lifecycleCounts.new },
            { value: "active", label: "Active", count: lifecycleCounts.active },
            { value: "expired", label: "Expired", count: lifecycleCounts.expired },
          ]}
        />
      )}

      {displayedDocuments.map((document) => {
        const isPending = document.id.startsWith("pending-");
        const lifecycle = isPending ? "new" : classifyDocument(document, viewedIds);
        const summary = documentSummaries[document.id];
        const isReading = readingDocId === document.id;
        const readPanel =
          readResult?.documentId === document.id ? readResult.result : null;
        const isPdf = document.fileName.toLowerCase().endsWith(".pdf");

        return (
        <div className="card" key={document.id}>
          <div className="row">
            <div>
              <div className="row-title-with-badge">
                {hasDownloadableFile(document.fileUrl) ? (
                  <button
                    type="button"
                    className="doc-title-button"
                    onClick={() => openDocument(document)}
                  >
                    📄 {document.fileName}
                  </button>
                ) : (
                  <strong>📄 {document.fileName}</strong>
                )}
                {lifecycle !== "active" && <LifecycleBadge lifecycle={lifecycle} />}
              </div>
              <p className="muted">
                {complianceLabel(document.docType)} · {formatFileSize(document.fileSize)} ·{" "}
                {isPending ? "Saving…" : prettyDate(document.createdAt)}
                {!isPending && document.expiresAt ? ` · expires ${prettyDate(document.expiresAt)}` : ""}
              </p>
              {summary && <p className="muted small doc-summary">{summary}</p>}
            </div>
            <div className="right-actions">
              {hasDownloadableFile(document.fileUrl) && (
                <button
                  type="button"
                  className="secondary doc-view-button"
                  onClick={() => openDocument(document)}
                >
                  View
                </button>
              )}
              {!readOnly && !isPending && isPdf && hasDownloadableFile(document.fileUrl) && (
                <button
                  type="button"
                  className="secondary"
                  disabled={isReading || extracting}
                  onClick={() => void handleReadDocument(document)}
                >
                  {isReading ? "Reading…" : "Read document"}
                </button>
              )}
              {!hasDownloadableFile(document.fileUrl) && !isPending && (
                <span className="muted small">No file attached</span>
              )}
              {isPending && <span className="muted small">Uploading…</span>}
              {!readOnly && !isPending && (
                <DeleteButton
                  onClick={async () => {
                    await deleteDocument(document.id);
                    setDocumentSummaries((current) => {
                      const next = { ...current };
                      delete next[document.id];
                      return next;
                    });
                    await onChanged();
                  }}
                />
              )}
            </div>
          </div>
          {readPanel && (
            <div className="doc-read-panel">
              <p className="label">
                AI read —{" "}
                {readPanel.documentTypeLabel ??
                  extractDocumentTypeLabel(readPanel.documentType) ??
                  "Document"}
              </p>
              {readPanel.summary && <p className="muted">{readPanel.summary}</p>}
              {isSpendDocumentType(readPanel.documentType) &&
                (readPanel.spendAmount != null || readPanel.value != null) && (
                  <p className="muted small">
                    Amount: {money(readPanel.spendAmount ?? readPanel.value ?? 0)}
                    {readPanel.spendDate ? ` · Date: ${prettyDate(readPanel.spendDate)}` : ""}
                  </p>
                )}
              {isContractLikeDocumentType(readPanel.documentType) && readPanel.name && (
                <p className="muted small">
                  Contract: {readPanel.name}
                  {readPanel.endDate ? ` · expires ${prettyDate(readPanel.endDate)}` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      );
      })}
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
  formRef,
}: {
  children: React.ReactNode;
  submitText: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  disabled?: boolean;
  formRef?: React.RefObject<HTMLFormElement | null>;
}) {
  return (
    <form ref={formRef} className="form-grid card" onSubmit={onSubmit}>
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
