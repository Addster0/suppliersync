import { FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  addInsuranceContract,
  createPayer,
  deleteInsuranceContract,
  deletePayer,
  fetchPayers,
  seedSamplePayers,
  updatePayer,
  uploadPayerFile,
} from "../api/insurance";
import { FileAttachmentLink } from "../components/FileAttachmentLink";
import { useOrganization } from "../contexts/OrganizationContext";
import { MAIN_CONTENT_ID } from "../lib/a11y";
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_BYTES,
  formatFileSize,
  getStatusClass,
  prettyDate,
} from "../lib/utils";
import type { FileAttachment, InsuranceContract, InsurancePayer, Status } from "../types";

const PAYER_TYPES = ["commercial", "government", "workers comp", "other"];

async function fileToStorageAttachment(
  organizationId: string,
  payerId: string,
  file: File
): Promise<FileAttachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatFileSize(file.size)}. Maximum ${formatFileSize(MAX_FILE_BYTES)} per file.`
    );
  }
  const uploaded = await uploadPayerFile(organizationId, payerId, file);
  return {
    fileName: file.name,
    fileSize: file.size,
    fileUrl: uploaded.fileUrl,
    mimeType: file.type || "application/octet-stream",
  };
}

export function InsurancePage() {
  const { activeMembership, canWrite } = useOrganization();
  const organizationId = activeMembership?.organizationId ?? "";
  const [searchParams] = useSearchParams();

  const [payers, setPayers] = useState<InsurancePayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedPayerId, setSelectedPayerId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [bannerMessage, setBannerMessage] = useState("");
  const [bannerError, setBannerError] = useState("");
  const [seeding, setSeeding] = useState(false);

  const reloadPayers = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setLoadError("");
    try {
      const data = await fetchPayers(organizationId);
      setPayers(data);
      setSelectedPayerId((current) => {
        if (current && data.some((payer) => payer.id === current)) return current;
        return data[0]?.id ?? "";
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load payers.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void reloadPayers();
  }, [reloadPayers]);

  useEffect(() => {
    if (!payers.length) return;
    const payerId = searchParams.get("payer");
    if (payerId && payers.some((payer) => payer.id === payerId)) {
      setSelectedPayerId(payerId);
    }
  }, [searchParams, payers]);

  const selectedPayer = payers.find((payer) => payer.id === selectedPayerId) ?? payers[0];

  const visiblePayers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return payers;
    return payers.filter(
      (payer) =>
        payer.name.toLowerCase().includes(query) ||
        payer.payerType.toLowerCase().includes(query) ||
        payer.notes.toLowerCase().includes(query)
    );
  }, [payers, searchQuery]);

  async function addPayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || !organizationId) return;

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const payerType = String(form.get("payerType") || "commercial");
    if (!name) return;

    try {
      setBannerError("");
      const created = await createPayer(organizationId, { name, payerType });
      await reloadPayers();
      setSelectedPayerId(created.id);
      setBannerMessage(`${name} added.`);
      event.currentTarget.reset();
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "Could not add payer.");
    }
  }

  async function removePayer(payer: InsurancePayer) {
    if (!canWrite) return;
    if (!window.confirm(`Delete ${payer.name} and all related contracts? This cannot be undone.`)) return;

    try {
      await deletePayer(payer.id);
      await reloadPayers();
      setBannerMessage(`${payer.name} removed.`);
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "Could not delete payer.");
    }
  }

  async function loadSampleData() {
    if (!canWrite || !organizationId) return;
    setSeeding(true);
    try {
      await seedSamplePayers(organizationId);
      await reloadPayers();
      setBannerMessage("Sample payers loaded.");
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "Could not load sample data.");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <main className="shell" id={MAIN_CONTENT_ID}>
      <aside className="sidebar">
        <div>
          <p className="eyebrow sidebar-workspace">Insurance CRM</p>
          <p className="small muted">Payer contracts and credentialing for {activeMembership?.organization.name}.</p>
        </div>

        <label className="vendor-search">
          <span className="label">Search payers</span>
          <input
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Name, type, notes…"
            value={searchQuery}
          />
        </label>

        {canWrite && (
          <form className="quick-add" onSubmit={addPayer}>
            <input name="name" placeholder="Payer name" required />
            <select defaultValue="commercial" name="payerType">
              {PAYER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <button type="submit">Add payer</button>
          </form>
        )}

        <div className="vendor-list">
          {loading ? (
            <p className="muted small">Loading payers…</p>
          ) : payers.length === 0 ? (
            <p className="muted small">No payers yet. Add one above or load sample data.</p>
          ) : visiblePayers.length === 0 ? (
            <p className="muted small">No payers match your search.</p>
          ) : (
            visiblePayers.map((payer) => (
              <button
                key={payer.id}
                type="button"
                className={payer.id === selectedPayer?.id ? "vendor-button selected" : "vendor-button"}
                onClick={() => setSelectedPayerId(payer.id)}
              >
                <span>{payer.name}</span>
                <small>{payer.payerType}</small>
              </button>
            ))
          )}
        </div>

        {canWrite && payers.length === 0 && !loading && (
          <button type="button" className="secondary full" onClick={() => void loadSampleData()} disabled={seeding}>
            {seeding ? "Loading sample data…" : "Load sample payers"}
          </button>
        )}
      </aside>

      <section className="content">
        {loadError && <div className="banner error">{loadError}</div>}
        {bannerMessage && <div className="banner success">{bannerMessage}</div>}
        {bannerError && <div className="banner error">{bannerError}</div>}

        {!loading && !selectedPayer && (
          <div className="empty card">Add a payer to start tracking insurance contracts.</div>
        )}

        {selectedPayer && (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">{selectedPayer.payerType}</p>
                <h2>{selectedPayer.name}</h2>
                <p className="muted">{selectedPayer.notes || "No notes yet."}</p>
              </div>
              <div className="right-actions">
                <span className={getStatusClass(selectedPayer.status)}>{selectedPayer.status}</span>
                {canWrite && (
                  <>
                    <select
                      aria-label="Payer status"
                      value={selectedPayer.status}
                      onChange={(event) =>
                        void updatePayer(selectedPayer.id, { status: event.target.value as Status }).then(
                          reloadPayers
                        )
                      }
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="pending">Pending</option>
                      <option value="expired">Expired</option>
                    </select>
                    <button className="delete" onClick={() => void removePayer(selectedPayer)} type="button">
                      Delete payer
                    </button>
                  </>
                )}
              </div>
            </header>

            <section className="grid two">
              <div className="card wide">
                <h3>Primary contact</h3>
                {canWrite ? (
                  <PayerContactForm payer={selectedPayer} onSaved={reloadPayers} />
                ) : (
                  <p className="muted">
                    {[selectedPayer.primaryContactName, selectedPayer.primaryContactEmail, selectedPayer.primaryContactPhone]
                      .filter(Boolean)
                      .join(" · ") || "No contact on file."}
                  </p>
                )}
              </div>
            </section>

            <InsuranceContractsSection
              onChanged={reloadPayers}
              organizationId={organizationId}
              payer={selectedPayer}
              readOnly={!canWrite}
            />
          </>
        )}
      </section>
    </main>
  );
}

function PayerContactForm({ payer, onSaved }: { payer: InsurancePayer; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await updatePayer(payer.id, {
        primaryContactName: String(form.get("name") || ""),
        primaryContactEmail: String(form.get("email") || ""),
        primaryContactPhone: String(form.get("phone") || ""),
        notes: String(form.get("notes") || ""),
      });
      await onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <input defaultValue={payer.primaryContactName} name="name" placeholder="Contact name" />
      <input defaultValue={payer.primaryContactEmail} name="email" placeholder="Email" type="email" />
      <input defaultValue={payer.primaryContactPhone} name="phone" placeholder="Phone" />
      <textarea defaultValue={payer.notes} name="notes" placeholder="Notes" rows={3} />
      {error && <p className="form-error">{error}</p>}
      <button disabled={saving} type="submit">
        {saving ? "Saving…" : "Save contact & notes"}
      </button>
    </form>
  );
}

function InsuranceContractsSection({
  payer,
  organizationId,
  readOnly,
  onChanged,
}: {
  payer: InsurancePayer;
  organizationId: string;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const inputId = useId();

  async function handleAddContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    const form = new FormData(event.currentTarget);
    const contract: Omit<InsuranceContract, "id"> = {
      title: String(form.get("title") || "").trim(),
      policyNumber: String(form.get("policyNumber") || "").trim(),
      startDate: String(form.get("startDate") || ""),
      endDate: String(form.get("endDate") || ""),
      credentialingStatus: String(form.get("credentialingStatus") || "active"),
      notes: String(form.get("notes") || ""),
    };

    try {
      if (contractFile) {
        contract.file = await fileToStorageAttachment(organizationId, payer.id, contractFile);
      }
      await addInsuranceContract(organizationId, payer.id, contract);
      await onChanged();
      event.currentTarget.reset();
      setContractFile(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save contract.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section">
      <div className="section-header">
        <h3>Participation contracts</h3>
      </div>

      {!readOnly && (
        <>
          <div className="notice">
            Attach the participation agreement or credentialing packet (up to {formatFileSize(MAX_FILE_BYTES)}).
          </div>
          <form className="form-grid card" onSubmit={handleAddContract}>
            <input name="title" placeholder="Contract title" required />
            <input name="policyNumber" placeholder="Policy / PTAN number" />
            <input name="startDate" required type="date" />
            <input name="endDate" required type="date" />
            <select defaultValue="active" name="credentialingStatus">
              <option value="active">Credentialed</option>
              <option value="pending">Pending</option>
              <option value="inactive">Inactive</option>
              <option value="expired">Expired</option>
            </select>
            <input name="notes" placeholder="Notes (optional)" />
            <div className="file-upload-row">
              <input
                accept={ACCEPTED_FILE_TYPES}
                className="drop-zone-input"
                id={inputId}
                onChange={(event) => setContractFile(event.target.files?.[0] ?? null)}
                type="file"
              />
              <label className="secondary file-upload-label" htmlFor={inputId}>
                {contractFile ? `Attached: ${contractFile.name}` : "Attach contract PDF (optional)"}
              </label>
              {contractFile && (
                <button className="ghost" onClick={() => setContractFile(null)} type="button">
                  Remove
                </button>
              )}
            </div>
            <button disabled={saving} type="submit">
              {saving ? "Saving…" : "Add contract"}
            </button>
          </form>
        </>
      )}

      {formError && <p className="form-error">{formError}</p>}
      {!payer.contracts.length && <div className="empty">No contracts added yet.</div>}

      {payer.contracts.map((contract) => (
        <div className="card row" key={contract.id}>
          <div>
            <strong>{contract.title}</strong>
            <p className="muted">
              {prettyDate(contract.startDate)} to {prettyDate(contract.endDate)}
              {contract.policyNumber ? ` · ${contract.policyNumber}` : ""}
            </p>
            <p className="muted small">{contract.credentialingStatus}</p>
            {contract.file && (
              <FileAttachmentLink
                fileName={contract.file.fileName}
                fileSize={contract.file.fileSize}
                fileUrl={contract.file.fileUrl}
              />
            )}
          </div>
          <div className="right-actions">
            {!readOnly && (
              <button
                className="delete"
                onClick={() => void deleteInsuranceContract(contract.id).then(onChanged)}
                type="button"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
