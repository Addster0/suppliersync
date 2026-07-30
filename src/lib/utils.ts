import type { FileAttachment } from "../types";

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const ACCEPTED_FILE_TYPES =
  ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,application/pdf,image/*";

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file. Try again."));
    reader.readAsDataURL(file);
  });
}

export async function fileToAttachment(file: File): Promise<FileAttachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatFileSize(file.size)}. Maximum ${formatFileSize(MAX_FILE_BYTES)} per file.`
    );
  }
  return {
    fileName: file.name,
    fileSize: file.size,
    fileUrl: await readFileAsDataUrl(file),
    mimeType: file.type || "application/octet-stream",
  };
}

export function normalizeStorageFileUrl(fileUrl: string) {
  const trimmed = fileUrl.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("sb://") || trimmed.startsWith("data:")) return trimmed;

  const storageMatch = trimmed.match(
    /\/storage\/v1\/object\/(?:sign|public)\/organization-files\/([^?]+)/
  );
  if (storageMatch) {
    return `sb://${decodeURIComponent(storageMatch[1])}`;
  }

  if (!trimmed.includes("://") && trimmed.includes("/")) {
    return `sb://${trimmed.replace(/^\/+/, "")}`;
  }

  return trimmed;
}

export function isDirectPreviewUrl(fileUrl: string) {
  const normalized = normalizeStorageFileUrl(fileUrl);
  return (
    normalized.startsWith("blob:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  );
}

export function hasDownloadableFile(fileUrl: string) {
  const normalized = normalizeStorageFileUrl(fileUrl);
  return isDirectPreviewUrl(normalized) || normalized.startsWith("sb://");
}

export function localFileToAttachment(file: File): FileAttachment {
  return {
    fileName: file.name,
    fileSize: file.size,
    fileUrl: URL.createObjectURL(file),
    mimeType: file.type || "application/octet-stream",
  };
}

export function revokeAttachmentUrl(attachment: FileAttachment | null | undefined) {
  if (attachment?.fileUrl.startsWith("blob:")) {
    URL.revokeObjectURL(attachment.fileUrl);
  }
}

export type FilePreviewKind = "pdf" | "image" | "other";

export function getFilePreviewKind(fileName: string, mimeType?: string): FilePreviewKind {
  const lower = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(lower)) return "image";
  return "other";
}

export function money(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function prettyDate(date: string) {
  if (!date) return "No date";
  return new Date(`${date}T00:00:00`).toLocaleDateString();
}

export function getStatusClass(status: string) {
  return `badge ${status}`;
}

/** Opens HTML in a new tab and triggers print. Uses a blob URL so it works with noopener pop-ups. */
export function openPrintableHtml(html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, "_blank", "noopener,noreferrer");

  if (!popup) {
    URL.revokeObjectURL(url);
    window.alert("Could not open print window. Allow pop-ups for this site and try again.");
    return;
  }

  const triggerPrint = () => {
    try {
      popup.focus();
      popup.print();
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  popup.addEventListener("load", triggerPrint, { once: true });
}
