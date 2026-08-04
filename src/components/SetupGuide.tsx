import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addContact,
  addContract,
  createVendor,
  deleteSampleVendors,
  seedSampleVendors,
  uploadAndAddDocument,
} from "../api/vendors";
import { useOrganization } from "../contexts/OrganizationContext";
import { useSetup } from "../contexts/SetupContext";
import { openClinicReport } from "../lib/clinicReport";
import { CONTRACT_END_HINT, CONTRACT_END_LABEL } from "../lib/renewals";
import type { SetupStepId } from "../lib/onboarding";
import { countSampleVendors } from "../lib/sampleVendors";
import type { VendorTemplate } from "../lib/vendorTemplates";
import { formatFileSize, MAX_FILE_BYTES } from "../lib/utils";
import { VendorImportPanel } from "./VendorImportPanel";
import { VendorTemplatePicker } from "./VendorTemplatePicker";

function todayIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function SetupGuide() {
  const { activeMembership, canWrite } = useOrganization();
  const organizationId = activeMembership?.organizationId ?? "";
  const workspaceName = activeMembership?.organization.name ?? "Workspace";

  const {
    vendors,
    renewals,
    steps,
    completedCount,
    totalSteps,
    isComplete,
    currentStep,
    setupOpen,
    closeSetup,
    refreshSetup,
    skipDocumentStep,
  } = useSetup();

  const [activeStepId, setActiveStepId] = useState<SetupStepId>("workspace");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [removingSamples, setRemovingSamples] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [vendorCategory, setVendorCategory] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const [templateHint, setTemplateHint] = useState("");

  useEffect(() => {
    if (!setupOpen) return;
    setActiveStepId(currentStep?.id ?? steps[steps.length - 1]?.id ?? "workspace");
    setError("");
  }, [setupOpen, currentStep, steps]);

  const activeStep = useMemo(
    () => steps.find((step) => step.id === activeStepId) ?? steps[0],
    [steps, activeStepId]
  );

  const sampleVendorCount = countSampleVendors(vendors);

  if (!setupOpen || !canWrite) return null;

  async function handleAddVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const name = vendorName.trim();
    const category = vendorCategory.trim();
    if (!name || !category) return;

    setBusy(true);
    setError("");
    try {
      await createVendor(organizationId, { name, category });
      await refreshSetup();
      setVendorName("");
      setVendorCategory("");
      setSelectedTemplateId(undefined);
      setTemplateHint("");
      setActiveStepId("renewal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add vendor.");
    } finally {
      setBusy(false);
    }
  }

  function handleTemplateSelect(template: VendorTemplate) {
    setSelectedTemplateId(template.id);
    setVendorCategory(template.category);
    setTemplateHint(template.hint);
  }

  async function handleAddRenewal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const form = new FormData(event.currentTarget);
    const vendorId = String(form.get("vendorId") || "");
    const name = String(form.get("name") || "").trim();
    const endDate = String(form.get("endDate") || "");
    const value = Number(form.get("value") || 0);
    if (!vendorId || !name || !endDate) {
      setError("Pick a vendor, contract name, and end date.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await addContract(organizationId, vendorId, {
        name,
        startDate: todayIsoDate(),
        endDate,
        renewalDate: null,
        renewalType: "fixed_term",
        noticePeriodDays: null,
        termMonths: null,
        value,
        status: "active",
      });
      await refreshSetup();
      window.dispatchEvent(new CustomEvent("suppliersync:vendors-changed"));
      event.currentTarget.reset();
      setActiveStepId("contact");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add contract.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const form = new FormData(event.currentTarget);
    const vendorId = String(form.get("vendorId") || "");
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const phone = String(form.get("phone") || "").trim();
    if (!vendorId || !name || (!email && !phone)) {
      setError("Vendor, name, and at least email or phone are required.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await addContact(organizationId, vendorId, {
        name,
        role: String(form.get("role") || "").trim(),
        email,
        phone,
      });
      await refreshSetup();
      event.currentTarget.reset();
      setActiveStepId("document");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add contact.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const form = new FormData(event.currentTarget);
    const vendorId = String(form.get("vendorId") || "");
    const file = form.get("file");
    if (!vendorId || !(file instanceof File) || !file.size) {
      setError("Pick a vendor and choose a file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`File is too large. Maximum ${formatFileSize(MAX_FILE_BYTES)}.`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      await uploadAndAddDocument(organizationId, vendorId, file, {
        docType: String(form.get("docType") || "general") as "general" | "coi" | "w9" | "license",
      });
      await refreshSetup();
      event.currentTarget.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadSample() {
    if (!organizationId) return;
    setSeeding(true);
    setError("");
    try {
      await seedSampleVendors(organizationId);
      await refreshSetup();
      setActiveStepId("renewal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load sample data.");
    } finally {
      setSeeding(false);
    }
  }

  async function handleRemoveSamples() {
    if (!organizationId) return;
    const confirmed = window.confirm(
      `Remove ${sampleVendorCount} sample vendor${sampleVendorCount === 1 ? "" : "s"} (e.g. Northstar, Brightline)? This cannot be undone.`
    );
    if (!confirmed) return;

    setRemovingSamples(true);
    setError("");
    try {
      const removed = await deleteSampleVendors(organizationId);
      await refreshSetup();
      window.dispatchEvent(new CustomEvent("suppliersync:vendors-changed"));
      if (removed === 0) {
        setError("No sample vendors found to remove.");
      } else if (vendors.length - removed <= 0) {
        setActiveStepId("vendors");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove sample vendors.");
    } finally {
      setRemovingSamples(false);
    }
  }

  function handleSkipDocument() {
    skipDocumentStep();
    setActiveStepId("document");
  }

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <section className="setup-guide card">
        <header className="setup-guide-header">
          <div>
            <p className="eyebrow">Workspace setup</p>
            <h2 id="setup-title">
              {isComplete ? "You're all set" : "Set up your clinic"}
            </h2>
            <p className="muted">
              {isComplete
                ? "Your workspace has vendors, renewals, and contacts on file."
                : "Complete these steps to unlock renewals tracking, compliance alerts, and your clinic report."}
            </p>
          </div>
          <button className="ghost setup-close" onClick={closeSetup} type="button">
            {isComplete ? "Close" : "Finish later"}
          </button>
        </header>

        <div className="setup-progress">
          <div className="setup-progress-bar">
            <span style={{ width: `${(completedCount / totalSteps) * 100}%` }} />
          </div>
          <p className="muted small">
            {completedCount} of {totalSteps} complete
          </p>
        </div>

        <ol className="setup-step-nav">
          {steps.map((step) => (
            <li key={step.id}>
              <button
                className={`setup-step-button${step.id === activeStepId ? " is-active" : ""}${step.done ? " is-done" : ""}`}
                onClick={() => setActiveStepId(step.id)}
                type="button"
              >
                <span className="setup-step-marker" aria-hidden="true">
                  {step.done ? "✓" : "○"}
                </span>
                <span>{step.label}</span>
                {step.optional && !step.done ? <small>Optional</small> : null}
              </button>
            </li>
          ))}
        </ol>

        <div className="setup-step-panel">
          {activeStep && (
            <>
              <h3>{activeStep.label}</h3>
              <p className="muted">{activeStep.description}</p>
            </>
          )}

          {activeStepId === "workspace" && (
            <div className="setup-panel-body">
              <p>
                Workspace: <strong>{workspaceName}</strong>
              </p>
              <p className="muted small">
                This is your clinic&apos;s private vendor hub. You can rename it anytime in Account settings.
              </p>
              <div className="setup-panel-actions">
                <button onClick={() => setActiveStepId("vendors")} type="button">
                  Continue
                </button>
                <Link className="secondary setup-link-button" to="/app/account" onClick={closeSetup}>
                  Open account settings
                </Link>
              </div>
            </div>
          )}

          {activeStepId === "vendors" && (
            <div className="setup-panel-body">
              <div className="setup-vendors-hero card">
                <strong>Most clinics import a spreadsheet in 2 minutes</strong>
                <p className="muted small">
                  Upload your Excel (.xlsx) or CSV vendor list — map columns once and we&apos;ll create vendors,
                  contacts, and renewal dates automatically.
                </p>
              </div>

              {organizationId && (
                <VendorImportPanel
                  compact
                  onImported={() => {
                    void refreshSetup().then(() => setActiveStepId("renewal"));
                  }}
                  organizationId={organizationId}
                />
              )}

              <div className="setup-vendors-divider">
                <span>Or add vendors one at a time</span>
              </div>

              <VendorTemplatePicker onSelect={handleTemplateSelect} selectedId={selectedTemplateId} />
              {templateHint && <p className="muted small setup-template-hint">{templateHint}</p>}

              <form className="setup-form-grid" onSubmit={(event) => void handleAddVendor(event)}>
                <input
                  onChange={(event) => setVendorName(event.target.value)}
                  placeholder="Vendor name"
                  required
                  value={vendorName}
                />
                <input
                  onChange={(event) => setVendorCategory(event.target.value)}
                  placeholder="Category"
                  required
                  value={vendorCategory}
                />
                <button disabled={busy} type="submit">
                  {busy ? "Adding…" : "Add vendor"}
                </button>
              </form>

              <div className="setup-panel-actions">
                <button className="secondary" disabled={seeding} onClick={() => void handleLoadSample()} type="button">
                  {seeding ? "Loading…" : "Explore with sample vendors"}
                </button>
                {sampleVendorCount > 0 && (
                  <button
                    className="delete"
                    disabled={removingSamples}
                    onClick={() => void handleRemoveSamples()}
                    type="button"
                  >
                    {removingSamples ? "Removing…" : `Remove ${sampleVendorCount} sample vendor${sampleVendorCount === 1 ? "" : "s"}`}
                  </button>
                )}
              </div>

              {sampleVendorCount > 0 && (
                <p className="muted small setup-sample-hint">
                  Sample vendors are for exploration only. Remove them when you&apos;re ready to add your real vendor list.
                </p>
              )}
            </div>
          )}

          {activeStepId === "renewal" && (
            <div className="setup-panel-body">
              {vendors.length === 0 ? (
                <p className="muted">Add a vendor first, then come back to this step.</p>
              ) : (
                <form className="setup-form-stack" onSubmit={(event) => void handleAddRenewal(event)}>
                  <label>
                    Vendor
                    <select name="vendorId" required defaultValue={vendors[0]?.id}>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Contract name
                    <input name="name" placeholder="e.g. Annual service agreement" required />
                  </label>
                  <label>
                    {CONTRACT_END_LABEL}
                    <input name="endDate" required type="date" />
                    <span className="muted small">{CONTRACT_END_HINT}</span>
                  </label>
                  <label>
                    Value (optional)
                    <input name="value" min="0" placeholder="18500" step="0.01" type="number" />
                  </label>
                  <button disabled={busy} type="submit">
                    {busy ? "Saving…" : "Save renewal date"}
                  </button>
                </form>
              )}
              {activeStep?.href && (
                <Link className="muted small setup-deep-link" to={activeStep.href} onClick={closeSetup}>
                  Or open the full contracts tab →
                </Link>
              )}
            </div>
          )}

          {activeStepId === "contact" && (
            <div className="setup-panel-body">
              {vendors.length === 0 ? (
                <p className="muted">Add a vendor first.</p>
              ) : (
                <form className="setup-form-stack" onSubmit={(event) => void handleAddContact(event)}>
                  <label>
                    Vendor
                    <select name="vendorId" required defaultValue={vendors[0]?.id}>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Contact name
                    <input name="name" placeholder="Jane Doe" required />
                  </label>
                  <label>
                    Role (optional)
                    <input name="role" placeholder="Account manager" />
                  </label>
                  <label>
                    Email
                    <input name="email" placeholder="jane@vendor.com" type="email" />
                  </label>
                  <label>
                    Phone
                    <input name="phone" placeholder="555-0100" />
                  </label>
                  <button disabled={busy} type="submit">
                    {busy ? "Saving…" : "Save contact"}
                  </button>
                </form>
              )}
            </div>
          )}

          {activeStepId === "document" && (
            <div className="setup-panel-body">
              {vendors.length === 0 ? (
                <p className="muted">Add a vendor first.</p>
              ) : (
                <>
                  <form className="setup-form-stack" onSubmit={(event) => void handleUploadDocument(event)}>
                    <label>
                      Vendor
                      <select name="vendorId" required defaultValue={vendors[0]?.id}>
                        {vendors.map((vendor) => (
                          <option key={vendor.id} value={vendor.id}>
                            {vendor.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Document type
                      <select name="docType" defaultValue="coi">
                        <option value="coi">Certificate of insurance (COI)</option>
                        <option value="w9">W-9 / tax form</option>
                        <option value="license">Business license</option>
                        <option value="general">General document</option>
                      </select>
                    </label>
                    <label>
                      File
                      <input accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" name="file" required type="file" />
                    </label>
                    <button disabled={busy} type="submit">
                      {busy ? "Uploading…" : "Upload document"}
                    </button>
                  </form>
                  {!activeStep?.done && (
                    <button className="secondary setup-skip" onClick={handleSkipDocument} type="button">
                      Skip for now
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {isComplete && (
            <div className="setup-complete card">
              <strong>Setup complete</strong>
              <p className="muted small">
                Renewals and action items will populate as you add more vendors. Turn on email digests on the Renewals
                page.
              </p>
              <div className="setup-panel-actions">
                <button
                  onClick={() => {
                    openClinicReport({ workspaceName, vendors, renewals });
                  }}
                  type="button"
                >
                  Print clinic report
                </button>
                <Link className="secondary setup-link-button" to="/app/renewals" onClick={closeSetup}>
                  Open renewals dashboard
                </Link>
              </div>
            </div>
          )}

          {error && <div className="banner error">{error}</div>}
        </div>
      </section>
    </div>
  );
}
