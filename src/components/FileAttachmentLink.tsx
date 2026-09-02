import { useState } from "react";
import { holdFilePreviewTab, openStorageFileInNewTab } from "../api/filePreview";
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
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const previewKind = getFilePreviewKind(fileName);

  if (!hasDownloadableFile(fileUrl)) {
    return variant === "title" ? <strong>📄 {fileName}</strong> : null;
  }

  const label =
    variant === "title"
      ? `Open ${fileName}`
      : `Open ${fileName}${fileSize != null ? ` (${formatFileSize(fileSize)})` : ""}`;

  const className = `file-attachment-link${variant === "title" ? " file-attachment-link--title" : ""}`;

  function handleClick() {
    setError("");
    if (onPreview) {
      if (previewKind === "pdf") holdFilePreviewTab(fileUrl, fileName);
      onPreview();
      return;
    }

    setOpening(true);
    void openStorageFileInNewTab(fileUrl, previewKind)
      .then((opened) => {
        if (!opened) {
          setError("Pop-up blocked. Allow pop-ups for this site and try again.");
        }
      })
      .catch((openError) => {
        setError(openError instanceof Error ? openError.message : "Could not open file.");
      })
      .finally(() => setOpening(false));
  }

  return (
    <div className="file-attachment-wrap">
      <button type="button" className={className} onClick={handleClick} disabled={opening}>
        {opening ? "Opening…" : label}
      </button>
      {error && (
        <p className="form-error file-attachment-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
