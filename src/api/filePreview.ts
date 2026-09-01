import { formatStorageError, ORG_FILES_BUCKET } from "../lib/storage";
import { requireSupabase } from "../lib/supabase";
import {
  getStoragePathFromFileUrl,
  isDirectPreviewUrl,
  normalizeStorageFileUrl,
  type FilePreviewKind,
} from "../lib/utils";

export type StoragePreview = {
  url: string;
  blob: Blob;
  revokeOnCleanup: boolean;
};

function typedPreviewBlob(blob: Blob, previewKind?: FilePreviewKind): Blob {
  if (previewKind === "pdf" && blob.type !== "application/pdf") {
    return new Blob([blob], { type: "application/pdf" });
  }
  return blob;
}

export async function downloadOrgFileBlob(fileUrl: string): Promise<Blob> {
  const normalized = normalizeStorageFileUrl(fileUrl);
  if (!normalized.startsWith("sb://")) {
    throw new Error("File URL must be an internal storage path (sb://).");
  }

  const path = getStoragePathFromFileUrl(normalized);
  const { data: blob, error } = await requireSupabase().storage.from(ORG_FILES_BUCKET).download(path);
  if (error || !blob) {
    throw new Error(formatStorageError(error?.message ?? "Could not open file."));
  }
  return blob;
}

/**
 * Same-origin blob URL for in-app preview. Never returns a Supabase or DocuSeal URL
 * (those cannot be framed under CSP frame-src).
 */
export async function resolveStoragePreview(
  fileUrl: string,
  previewKind?: FilePreviewKind,
): Promise<StoragePreview> {
  const normalized = normalizeStorageFileUrl(fileUrl);

  if (isDirectPreviewUrl(normalized)) {
    const blob = typedPreviewBlob(await fetch(normalized).then((response) => response.blob()), previewKind);
    if (previewKind === "pdf" && blob.type === "application/pdf" && !normalized.startsWith("blob:")) {
      return { url: URL.createObjectURL(blob), blob, revokeOnCleanup: true };
    }
    return { url: normalized, blob, revokeOnCleanup: false };
  }

  const blob = typedPreviewBlob(await downloadOrgFileBlob(normalized), previewKind);
  return { url: URL.createObjectURL(blob), blob, revokeOnCleanup: true };
}
