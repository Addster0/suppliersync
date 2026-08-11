import { useEffect, useRef, useState } from "react";
import {
  createVendorStickyNote,
  deleteVendorStickyNote,
  updateVendorStickyNote,
} from "../api/vendors";
import { prettyDate } from "../lib/utils";
import type { VendorStickyNote } from "../types";

type Props = {
  organizationId: string;
  vendorId: string;
  notes: VendorStickyNote[];
  readOnly: boolean;
  /** Called with the latest notes after a successful create/update/delete. */
  onNotesChange: (notes: VendorStickyNote[]) => void;
};

function isLocalNoteId(id: string) {
  return id.startsWith("local-");
}

function sortNotes(notes: VendorStickyNote[]) {
  return [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Merge server notes with in-flight local cards / just-saved cards not yet in props. */
function mergeNotes(serverNotes: VendorStickyNote[], localNotes: VendorStickyNote[]) {
  const serverIds = new Set(serverNotes.map((note) => note.id));
  const pending = localNotes.filter((note) => !serverIds.has(note.id));
  return sortNotes([...pending, ...serverNotes]);
}

export function VendorNotesEditor({
  organizationId,
  vendorId,
  notes,
  readOnly,
  onNotesChange,
}: Props) {
  const [localNotes, setLocalNotes] = useState<VendorStickyNote[]>(() => sortNotes(notes));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const prevVendorIdRef = useRef(vendorId);
  const localNotesRef = useRef(localNotes);
  localNotesRef.current = localNotes;

  useEffect(() => {
    if (prevVendorIdRef.current !== vendorId) {
      prevVendorIdRef.current = vendorId;
      setLocalNotes(sortNotes(notes));
      setEditingId(null);
      setDrafts({});
      setError("");
      return;
    }
    setLocalNotes((current) => mergeNotes(notes, current));
  }, [notes, vendorId]);

  function startEdit(note: VendorStickyNote) {
    setEditingId(note.id);
    setDrafts((current) => ({ ...current, [note.id]: note.body }));
    setError("");
  }

  function cancelEdit(noteId: string) {
    setEditingId((current) => (current === noteId ? null : current));
    setDrafts((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });

    // Unsaved draft cards are local-only — drop them on cancel.
    if (isLocalNoteId(noteId)) {
      setLocalNotes((current) => current.filter((note) => note.id !== noteId));
    }
  }

  async function saveNote(noteId: string) {
    const body = (drafts[noteId] ?? "").trim();
    if (!body) {
      setError("Note cannot be empty. Delete it instead or add some text.");
      return;
    }

    setSavingId(noteId);
    setError("");
    try {
      const saved = isLocalNoteId(noteId)
        ? await createVendorStickyNote(organizationId, vendorId, body)
        : await updateVendorStickyNote(noteId, body);

      const nextNotes = sortNotes(
        localNotesRef.current
          .filter((note) => note.id !== noteId && note.id !== saved.id)
          .concat(saved)
      );
      setLocalNotes(nextNotes);
      setEditingId(null);
      setDrafts((current) => {
        const next = { ...current };
        delete next[noteId];
        delete next[saved.id];
        return next;
      });
      onNotesChange(nextNotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save note.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeNote(note: VendorStickyNote) {
    if (!window.confirm("Delete this note?")) return;

    // Local draft — never hit the server.
    if (isLocalNoteId(note.id)) {
      setLocalNotes((current) => current.filter((item) => item.id !== note.id));
      if (editingId === note.id) setEditingId(null);
      setDrafts((current) => {
        const next = { ...current };
        delete next[note.id];
        return next;
      });
      return;
    }

    setSavingId(note.id);
    setError("");
    try {
      await deleteVendorStickyNote(note.id);
      const nextNotes = localNotesRef.current.filter((item) => item.id !== note.id);
      setLocalNotes(nextNotes);
      if (editingId === note.id) setEditingId(null);
      onNotesChange(nextNotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete note.");
    } finally {
      setSavingId(null);
    }
  }

  function addNoteCard() {
    if (readOnly || editingId) return;
    const now = new Date().toISOString();
    const draftNote: VendorStickyNote = {
      id: `local-${crypto.randomUUID()}`,
      body: "",
      createdAt: now,
      updatedAt: now,
    };
    setLocalNotes((current) => [draftNote, ...current]);
    startEdit(draftNote);
  }

  const canAdd = !readOnly && !editingId;

  return (
    <div className="vendor-notes-editor">
      <div className="vendor-notes-editor-head">
        <div className="vendor-notes-editor-title">
          <p className="label">Notes</p>
          <span className="muted small">
            {localNotes.length} note{localNotes.length === 1 ? "" : "s"}
          </span>
        </div>
        {!readOnly ? (
          <button
            className="sticky-note-add"
            disabled={!canAdd}
            onClick={addNoteCard}
            type="button"
          >
            Add note
          </button>
        ) : (
          <span className="muted small">View only</span>
        )}
      </div>

      {readOnly && localNotes.length === 0 && (
        <p className="muted small vendor-notes-empty">
          No notes yet. Ask a workspace owner or admin if you need to add notes.
        </p>
      )}

      {!readOnly && localNotes.length === 0 && (
        <p className="muted small vendor-notes-empty">
          Sticky notes for renewal context, account numbers, or reminders.
        </p>
      )}

      <div className="sticky-notes-grid">
        {localNotes.map((note) => {
          const isEditing = editingId === note.id;
          const isSaving = savingId === note.id;
          const updatedLabel = note.updatedAt?.slice(0, 10);

          return (
            <article className="sticky-note-card" key={note.id}>
              {isEditing ? (
                <>
                  <textarea
                    autoFocus
                    className="sticky-note-textarea"
                    disabled={isSaving}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [note.id]: event.target.value }))
                    }
                    placeholder="Write your note…"
                    rows={4}
                    value={drafts[note.id] ?? note.body}
                  />
                  <div className="sticky-note-actions">
                    <button disabled={isSaving} onClick={() => void saveNote(note.id)} type="button">
                      {isSaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      className="secondary"
                      disabled={isSaving}
                      onClick={() => cancelEdit(note.id)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="sticky-note-body">{note.body || "Empty note"}</p>
                  {updatedLabel && (
                    <p className="sticky-note-meta muted small">{prettyDate(updatedLabel)}</p>
                  )}
                  {!readOnly && (
                    <div className="sticky-note-actions">
                      <button className="secondary" disabled={isSaving} onClick={() => startEdit(note)} type="button">
                        Edit
                      </button>
                      <button
                        className="ghost vendor-notes-delete"
                        disabled={isSaving}
                        onClick={() => void removeNote(note)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </>
              )}
            </article>
          );
        })}

        {!readOnly && (
          <button
            className="sticky-note-add-card"
            disabled={!canAdd}
            onClick={addNoteCard}
            type="button"
          >
            <span className="sticky-note-add-card-plus" aria-hidden="true">
              +
            </span>
            <span>Add note</span>
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
