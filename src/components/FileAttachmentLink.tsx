import { useEffect, useState, type MouseEvent } from "react";
import { openFileUrl, resolveStorageUrl } from "../api/vendors";
import { formatFileSize, hasDownloadableFile, normalizeStorageFileUrl } from "../lib/utils";

type FileAttachmentLinkProps = {
  fileUrl: string;
  fileName: string;
  fileSize?: number;
  variant?: "inline" | "title";
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

export function FileAttachmentLink({
  fileUrl,
  fileName,
  fileSize,
  variant = "inline",
  onClick,
}: FileAttachmentLinkProps) {
  const [href, setHref] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHref(null);
    setError("");
    setLoading(true);

    if (!hasDownloadableFile(fileUrl)) {
      setLoading(false);
      return;
    }

    const normalized = normalizeStorageFileUrl(fileUrl);
    if (normalized.startsWith("http") || normalized.startsWith("data:")) {
      setHref(normalized);
      setLoading(false);
      return;
    }

    void resolveStorageUrl(fileUrl)
      .then((url) => {
        if (!cancelled) setHref(url);
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
    };
  }, [fileUrl]);

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

  if (error || !href) {
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
            void openFileUrl(fileUrl).catch((openError) => {
              setError(openError instanceof Error ? openError.message : "Could not open file.");
            }).finally(() => setRetrying(false));
          }}
        >
          {retrying ? "Opening…" : "Open file"}
        </button>
        {error && <p className="form-error file-attachment-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="file-attachment-wrap">
      <a
        href={href}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        download={href.startsWith("blob:") ? fileName : undefined}
      >
        {label}
      </a>
    </div>
  );
}
