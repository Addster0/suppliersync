import { useEffect, useRef, useState } from "react";
import { resolveStoragePreview } from "../api/filePreview";
import { openFileUrl } from "../api/vendors";
import { useFocusTrap } from "../lib/a11y";
import {
  downloadBlob,
  formatFileSize,
  getFilePreviewKind,
  hasDownloadableFile,
} from "../lib/utils";

type DocumentViewerModalProps = {
  fileUrl: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  onClose: () => void;
};

export function DocumentViewerModal({
  fileUrl,
  fileName,
  fileSize,
  mimeType,
  onClose,
}: DocumentViewerModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewKind = getFilePreviewKind(fileName, mimeType);

  useFocusTrap(dialogRef, true);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let createdBlobUrl: string | null = null;
    setUrl(null);
    setPreviewBlob(null);
    setError("");
    setLoading(true);

    if (!hasDownloadableFile(fileUrl)) {
      setError("No file attached.");
      setLoading(false);
      return;
    }

    void resolveStoragePreview(fileUrl, previewKind)
      .then((preview) => {
        if (cancelled) {
          if (preview.revokeOnCleanup) URL.revokeObjectURL(preview.url);
          return;
        }
        if (preview.revokeOnCleanup) createdBlobUrl = preview.url;
        setPreviewBlob(preview.blob);
        setUrl(preview.url);
      })
      .catch((resolveError) => {
        if (!cancelled) {
          setError(resolveError instanceof Error ? resolveError.message : "Could not load file.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
  }, [fileUrl, previewKind]);

  function handleOpen() {
    void openFileUrl(fileUrl).catch((openError) => {
      setError(openError instanceof Error ? openError.message : "Could not open file.");
    });
  }

  function handleDownload() {
    if (previewBlob) {
      downloadBlob(previewBlob, fileName);
      return;
    }
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  const actionsReady = Boolean(url || previewBlob);

  return (
    <div className="doc-viewer-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`doc-viewer card${previewKind === "image" ? " doc-viewer--preview" : ""}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-viewer-title"
      >
        <header className="doc-viewer-head">
          <div>
            <h2 id="doc-viewer-title">{fileName}</h2>
            {fileSize != null && <p className="muted small">{formatFileSize(fileSize)}</p>}
          </div>
          <div className="doc-viewer-head-actions">
            {actionsReady && (
              <>
                <button type="button" onClick={handleOpen}>
                  Open in new tab
                </button>
                <button type="button" className="secondary" onClick={handleDownload}>
                  Download
                </button>
              </>
            )}
            <button type="button" className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="doc-viewer-body">
          {loading && (
            <p className="muted" role="status" aria-live="polite">
              Loading document…
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && url && previewKind === "pdf" && (
            <div className="doc-viewer-pdf-panel">
              <p>
                PDFs open in a new tab so your browser can display them. Use Open in new tab or Download
                below.
              </p>
              <div className="doc-viewer-actions">
                <button type="button" onClick={handleOpen}>
                  Open in new tab
                </button>
                <button type="button" className="secondary" onClick={handleDownload}>
                  Download
                </button>
              </div>
            </div>
          )}
          {!loading && !error && url && previewKind === "image" && (
            <img src={url} alt={fileName} className="doc-viewer-image" />
          )}
          {!loading && !error && url && previewKind === "other" && (
            <div className="doc-viewer-fallback">
              <p className="muted">Preview isn&apos;t available for this file type. Open or download it instead.</p>
              <div className="doc-viewer-actions">
                <button type="button" onClick={handleOpen}>
                  Open in new tab
                </button>
                <button type="button" className="secondary" onClick={handleDownload}>
                  Download
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
