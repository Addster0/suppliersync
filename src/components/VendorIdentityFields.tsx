import { useEffect, useState } from "react";
import { updateVendorCore } from "../api/vendors";

type Props = {
  vendorId: string;
  name: string;
  category: string;
  readOnly: boolean;
  onSaved: () => void | Promise<void>;
};

export function VendorIdentityFields({ vendorId, name, category, readOnly, onSaved }: Props) {
  const [draftName, setDraftName] = useState(name);
  const [draftCategory, setDraftCategory] = useState(category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraftName(name);
    setDraftCategory(category);
    setError("");
  }, [vendorId, name, category]);

  const trimmedName = draftName.trim();
  const trimmedCategory = draftCategory.trim();
  const isDirty = trimmedName !== name || trimmedCategory !== category;
  const canSave = isDirty && trimmedName.length > 0 && trimmedCategory.length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await updateVendorCore(vendorId, {
        name: trimmedName,
        category: trimmedCategory,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save vendor details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="vendor-identity-fields">
      <div className="vendor-identity-grid">
        <div>
          <p className="label">Vendor name</p>
          <input
            disabled={readOnly || saving}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Vendor name"
            value={draftName}
            aria-label="Vendor name"
          />
        </div>
        <div>
          <p className="label">Category</p>
          <input
            disabled={readOnly || saving}
            onChange={(event) => setDraftCategory(event.target.value)}
            placeholder="Category (e.g. Lab, IT)"
            value={draftCategory}
            aria-label="Category"
          />
        </div>
      </div>
      {!readOnly && (
        <div className="vendor-identity-actions">
          <button disabled={saving || !canSave} onClick={() => void handleSave()} type="button">
            {saving ? "Saving…" : "Save vendor details"}
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      {!readOnly && isDirty && (!trimmedName || !trimmedCategory) && (
        <p className="form-error">Name and category are required.</p>
      )}
    </div>
  );
}
