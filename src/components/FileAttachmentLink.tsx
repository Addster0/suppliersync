import { useEffect, useState } from "react";
import { holdFilePreviewTab, openStorageFileInNewTab, resolveStoragePreview } from "../api/filePreview";
import {
  formatFileSize,
  getFilePreviewKind,
  hasDownloadableFile,
} from "../lib/utils";

type FileAttachmentLinkProps = {
  fileUrl: string;
  fileName: string;
  fileSize?: number;
  variant?: "inline" | "title";
  /** Opens in-app preview instead of a new browser tab. */
  onPreview?: () => void;
};

export function FileAttachmentLink({
  fileUrl,
  fileName,
  fileSize,
  variant = "inline",
  onPreview,
}: FileAttachmentLinkProps) {
  const [href, setHref] = useState<string | null>(null);
  const [loading, setLoading] = useState(!onPreview);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const previewKind = getFilePreviewKind(fileName);

  useEffect(() => {
    if (onPreview) {
      setHref(null);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    let createdBlobUrl: string | null = null;
    setHref(null);
    setError("");
    setLoading(true);

    if (!hasDownloadableFile(fileUrl)) {
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
        setHref(preview.url);
      })
      .catch((resolveError) => {
        if (!cancelled) {
          setError(resolveError instanceof Error ? resolveError.message : "Could not load file link.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (createdBlobUrl) {
        const toRevoke = createdBlobUrl;
        window.setTimeout(() => URL.revokeObjectURL(toRevoke), 60 * 60 * 1000);
      }
    };
  }, [fileUrl, onPreview, previewKind]);

  if (!hasDownloadableFile(fileUrl)) {
    return variant === "title" ? <strong>📄 {fileName}</strong> : null;
  }

  const label =
    variant === "title"
      ? `Open ${fileName}`
      : `Open ${fileName}${fileSize != null ? ` (${formatFileSize(fileSize)})` : ""}`;

  const className = `file-attachment-link${variant === "title" ? " file-attachment-link--title" : ""}`;

  if (loading) {
    return <span className="file-attachment-loading muted small">Preparing file link…</span>;
  }

  if (error || (!href && !onPreview)) {
    return (
      <div className="file-attachment-wrap">
        <span className="muted small">📄 {fileName}</span>
        <button
          type="button"
          className="file-attachment-retry secondary"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            setError("");
            void openStorageFileInNewTab(fileUrl, previewKind)
              .then((opened) => {
                if (!opened) {
                  setError("Pop-up blocked. Allow pop-ups for this site and try again.");
                }
              })
              .catch((openError) => {
                setError(openError instanceof Error ? openError.message : "Could not open file.");
              })
              .finally(() => setRetrying(false));
          }}
        >
          {retrying ? "Opening…" : "Open file"}
        </button>
        {error && <p className="form-error file-attachment-error">{error}</p>}
      </div>
    );
  }

  if (onPreview) {
    return (
      <div className="file-attachment-wrap">
        <button
          type="button"
          className={className}
          onClick={() => {
            if (previewKind === "pdf") holdFilePreviewTab(fileUrl, fileName);
            onPreview();
          }}
        >
          {label}
        </button>
      </div>
    );
  }

  return (
    <div className="file-attachment-wrap">
      <a href={href!} className={className} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    </div>
  );
}
