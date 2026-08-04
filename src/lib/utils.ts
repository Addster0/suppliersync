import type { FileAttachment } from "../types";

export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** orgId/vendorId/filename — no path traversal, no extra segments */
export const STORAGE_OBJECT_PATH_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/]+$/;

const BLOCKED_UPLOAD_MIME_TYPES = new Set(["text/html", "image/svg+xml"]);

export const ACCEPTED_FILE_TYPES =
  ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg,image/gif,image/webp,text/plain,text/csv";

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function assertAllowedUploadMime(file: File) {
  const mime = (file.type || "").toLowerCase();
  if (BLOCKED_UPLOAD_MIME_TYPES.has(mime)) {
    throw new Error(`"${file.name}" file type is not allowed.`);
  }
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm") || lowerName.endsWith(".svg")) {
    throw new Error(`"${file.name}" file type is not allowed.`);
  }
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
  assertAllowedUploadMime(file);
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

function storagePathFromSignedUrl(fileUrl: string): string | null {
  const storageMatch = fileUrl.match(
    /\/storage\/v1\/object\/(?:sign|public)\/organization-files\/([^?]+)/
  );
  if (!storageMatch) return null;

  const path = decodeURIComponent(storageMatch[1]);
  if (path.includes("..") || !STORAGE_OBJECT_PATH_PATTERN.test(path)) return null;
  return path;
}

export function parseStorageFileUrl(fileUrl: string): string | null {
  const trimmed = fileUrl.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("sb://")) {
    const path = trimmed.slice(5);
    if (path.includes("..") || !STORAGE_OBJECT_PATH_PATTERN.test(path)) return null;
    return `sb://${path}`;
  }

  const signedPath = storagePathFromSignedUrl(trimmed);
  if (signedPath) return `sb://${signedPath}`;

  if (!trimmed.includes("://") && trimmed.includes("/")) {
    const path = trimmed.replace(/^\/+/, "");
    if (path.includes("..") || !STORAGE_OBJECT_PATH_PATTERN.test(path)) return null;
    return `sb://${path}`;
  }

  return null;
}

export function assertValidStorageFileUrl(fileUrl: string): string {
  const parsed = parseStorageFileUrl(fileUrl);
  if (!parsed) {
    throw new Error("File URL must be an internal storage path (sb://).");
  }
  return parsed;
}

export function getStoragePathFromFileUrl(fileUrl: string): string {
  const parsed = assertValidStorageFileUrl(fileUrl);
  return parsed.slice(5);
}

export function normalizeStorageFileUrl(fileUrl: string) {
  const trimmed = fileUrl.trim();
  if (!trimmed) return trimmed;

  const parsed = parseStorageFileUrl(trimmed);
  if (parsed) return parsed;

  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;

  return trimmed;
}

export function isDirectPreviewUrl(fileUrl: string) {
  const normalized = normalizeStorageFileUrl(fileUrl);
  return normalized.startsWith("blob:") || normalized.startsWith("data:");
}

export function hasDownloadableFile(fileUrl: string) {
  const normalized = normalizeStorageFileUrl(fileUrl);
  return isDirectPreviewUrl(normalized) || normalized.startsWith("sb://");
}

export function localFileToAttachment(file: File): FileAttachment {
  assertAllowedUploadMime(file);
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
