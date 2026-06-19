import { useEffect, useState } from "react";
import { updateVendorCore } from "../api/vendors";

type Props = {
  vendorId: string;
  notes: string;
  notesLocked: boolean;
  readOnly: boolean;
  onSaved: () => void | Promise<void>;
};

export function VendorNotesEditor({ vendorId, notes, notesLocked, readOnly, onSaved }: Props) {
  const [draft, setDraft] = useState(notes);
  const [locked, setLocked] = useState(notesLocked);
  const [editing, setEditing] = useState(!notesLocked);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(notes);
    setLocked(notesLocked);
    setEditing(!notesLocked);
    setError("");
  }, [vendorId, notes, notesLocked]);

  const isDirty = draft !== notes;
  const canEdit = !readOnly && editing && !locked;

  async function persist(nextNotes: string, nextLocked: boolean) {
    setSaving(true);
    setError("");
    try {
      await updateVendorCore(vendorId, { notes: nextNotes, notesLocked: nextLocked });
      setLocked(nextLocked);
      setEditing(!nextLocked);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save notes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    await persist(draft, locked);
  }

  async function handleFinalize() {
    await persist(draft, true);
  }

  async function handleDelete() {
    if (!window.confirm("Delete all notes for this vendor?")) return;
    setDraft("");
    await persist("", false);
  }

  async function handleEdit() {
    setEditing(true);
    setError("");
    if (locked) {
      setSaving(true);
      try {
        await updateVendorCore(vendorId, { notesLocked: false });
        setLocked(false);
        await onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not unlock notes.");
      } finally {
        setSaving(false);
      }
    }
  }

  return (
    <div className="vendor-notes-editor">
      <div className="vendor-notes-editor-head">
        <p className="label">Notes</p>
        {locked && <span className="vendor-notes-badge">Finalized</span>}
      </div>

      <textarea
        className="vendor-notes-textarea"
        disabled={!canEdit || saving}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Internal notes — addresses, account numbers, renewal context…"
        rows={5}
        value={draft}
      />

      {!readOnly && (
        <div className="vendor-notes-actions">
          {canEdit ? (
            <>
              <button disabled={saving || !isDirty} onClick={() => void handleSave()} type="button">
                {saving ? "Saving…" : "Save notes"}
              </button>
              <button
                className="secondary"
                disabled={saving || !draft.trim()}
                onClick={() => void handleFinalize()}
                type="button"
              >
                Finalize
              </button>
              <button
                className="ghost vendor-notes-delete"
                disabled={saving || (!notes && !draft)}
                onClick={() => void handleDelete()}
                type="button"
              >
                Delete notes
              </button>
            </>
          ) : (
            <button className="secondary" disabled={saving} onClick={() => void handleEdit()} type="button">
              Edit notes
            </button>
          )}
        </div>
      )}

      {locked && !readOnly && (
        <p className="muted small vendor-notes-hint">Finalized notes are read-only until you click Edit notes.</p>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
