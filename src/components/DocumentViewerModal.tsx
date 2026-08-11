import { useEffect, useRef, useState } from "react";
import { openFileUrl, resolveStorageUrl } from "../api/vendors";
import { useFocusTrap } from "../lib/a11y";
import {
  formatFileSize,
  getFilePreviewKind,
  hasDownloadableFile,
  isDirectPreviewUrl,
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
    setUrl(null);
    setError("");
    setLoading(true);

    if (!hasDownloadableFile(fileUrl)) {
      setError("No file attached.");
      setLoading(false);
      return;
    }

    if (isDirectPreviewUrl(fileUrl)) {
      setUrl(fileUrl);
      setLoading(false);
      return;
    }

    void resolveStorageUrl(fileUrl)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
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
    };
  }, [fileUrl]);

  return (
    <div className="doc-viewer-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`doc-viewer card${previewKind !== "other" ? " doc-viewer--preview" : ""}`}
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
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="doc-viewer-body">
          {loading && <p className="muted" role="status" aria-live="polite">Loading document…</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && url && previewKind === "pdf" && (
            <iframe
              title={fileName}
              src={url}
              className="doc-viewer-frame"
              sandbox="allow-same-origin allow-downloads"
            />
          )}
          {!loading && !error && url && previewKind === "image" && (
            <img src={url} alt={fileName} className="doc-viewer-image" />
          )}
          {!loading && !error && url && previewKind === "other" && (
            <div className="doc-viewer-fallback">
              <p className="muted">Preview isn&apos;t available for this file type. Open or download it instead.</p>
              <div className="doc-viewer-actions">
                <button type="button" className="secondary" onClick={() => void openFileUrl(fileUrl)}>
                  Open in new tab
                </button>
                <a href={url} download={fileName} className="secondary doc-viewer-download">
                  Download
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
