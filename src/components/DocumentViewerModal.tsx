import { useEffect, useRef, useState } from "react";
import {
  closeHeldPreviewTab,
  navigateHeldPreviewTab,
  openBlobInNewTab,
  openStorageFileInNewTab,
  previewTabKey,
  resolveStoragePreview,
} from "../api/filePreview";
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
  const [popupBlocked, setPopupBlocked] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewKind = getFilePreviewKind(fileName, mimeType);
  const previewKey = previewTabKey(fileUrl, fileName);

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
        if (previewKind === "pdf") {
          setPopupBlocked(!navigateHeldPreviewTab(previewKey, preview.blob));
        }
      })
      .catch((resolveError) => {
        closeHeldPreviewTab(previewKey);
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
  }, [fileUrl, previewKind, previewKey]);

  function handleOpen() {
    if (previewBlob) {
      setPopupBlocked(!openBlobInNewTab(previewBlob));
      return;
    }
    void openStorageFileInNewTab(fileUrl, previewKind)
      .then((opened) => setPopupBlocked(!opened))
      .catch((openError) => {
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
  const showPreviewFrame = previewKind === "pdf" || previewKind === "image";

  return (
    <div className="doc-viewer-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`doc-viewer card${showPreviewFrame ? " doc-viewer--preview" : ""}`}
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
            <>
              {popupBlocked && (
                <p className="muted small">
                  Pop-up blocked, so the PDF is shown here. Use Open in new tab if you allow pop-ups.
                </p>
              )}
              <embed src={url} type="application/pdf" className="doc-viewer-frame" />
            </>
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
