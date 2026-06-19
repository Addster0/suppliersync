import { useEffect, useState } from "react";
import { updateVendorCore } from "../api/vendors";

type Props = {
  vendorId: string;
  address: string;
  readOnly: boolean;
  onSaved: () => void | Promise<void>;
};

export function VendorAddressField({ vendorId, address, readOnly, onSaved }: Props) {
  const [draft, setDraft] = useState(address);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(address);
    setError("");
  }, [vendorId, address]);

  const isDirty = draft !== address;

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await updateVendorCore(vendorId, { address: draft.trim() });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save address.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="vendor-address-field">
      <p className="label">Address</p>
      <input
        disabled={readOnly || saving}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Street, suite, city, state ZIP"
        value={draft}
      />
      {!readOnly && (
        <div className="vendor-address-actions">
          <button disabled={saving || !isDirty} onClick={() => void handleSave()} type="button">
            {saving ? "Saving…" : "Save address"}
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
