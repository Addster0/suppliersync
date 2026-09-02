import { formatStorageError, ORG_FILES_BUCKET } from "../lib/storage";
import { requireSupabase } from "../lib/supabase";
import {
  getFilePreviewKind,
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

const BLOB_URL_REVOKE_MS = 60 * 60 * 1000;

let heldPreviewTab: { key: string; tab: Window } | null = null;

function asTypedBlob(blob: Blob, previewKind?: FilePreviewKind): Blob {
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
    const blob = asTypedBlob(await fetch(normalized).then((response) => response.blob()), previewKind);
    if (previewKind === "pdf") {
      return { url: URL.createObjectURL(blob), blob, revokeOnCleanup: true };
    }
    return { url: normalized, blob, revokeOnCleanup: false };
  }

  const blob = asTypedBlob(await downloadOrgFileBlob(normalized), previewKind);
  return { url: URL.createObjectURL(blob), blob, revokeOnCleanup: true };
}

function markTabLoading(tab: Window, fileName: string) {
  try {
    tab.document.title = fileName;
    tab.document.body.textContent = "Loading document…";
  } catch {
    // about:blank is usually writable; ignore if the browser blocks it.
  }
}

export function previewTabKey(fileUrl: string, fileName: string) {
  return `${fileUrl}::${fileName}`;
}

/**
 * Open about:blank in the current user-gesture turn so later blob navigation
 * is not popup-blocked. Reuses the tab across React Strict Mode remounts.
 */
export function holdPreviewTab(key: string, fileName: string): Window | null {
  if (heldPreviewTab && heldPreviewTab.key === key && !heldPreviewTab.tab.closed) {
    return heldPreviewTab.tab;
  }

  const tab = window.open("about:blank", "_blank");
  if (!tab) {
    heldPreviewTab = null;
    return null;
  }

  tab.opener = null;
  markTabLoading(tab, fileName);
  heldPreviewTab = { key, tab };
  return tab;
}

/** Call from a click handler so Chrome still treats the later blob navigation as user-initiated. */
export function holdFilePreviewTab(fileUrl: string, fileName: string): Window | null {
  return holdPreviewTab(previewTabKey(fileUrl, fileName), fileName);
}

export function closeHeldPreviewTab(key: string) {
  if (!heldPreviewTab || heldPreviewTab.key !== key) return;
  if (!heldPreviewTab.tab.closed) heldPreviewTab.tab.close();
  heldPreviewTab = null;
}

export function openBlobInNewTab(blob: Blob): Window | null {
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, "_blank");
  if (!popup) {
    URL.revokeObjectURL(url);
    return null;
  }
  popup.opener = null;
  window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_MS);
  return popup;
}

export function navigateHeldPreviewTab(key: string, blob: Blob): boolean {
  if (!heldPreviewTab || heldPreviewTab.key !== key || heldPreviewTab.tab.closed) {
    return false;
  }
  const url = URL.createObjectURL(blob);
  heldPreviewTab.tab.location.replace(url);
  window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_MS);
  return true;
}

/** Fetch via the authenticated client, then open an application/pdf blob in a new tab. */
export async function openStorageFileInNewTab(
  fileUrl: string,
  previewKind?: FilePreviewKind,
): Promise<boolean> {
  const kind = previewKind ?? getFilePreviewKind(fileUrl);
  const tab = holdPreviewTab(`open:${fileUrl}`, fileUrl);
  try {
    const preview = await resolveStoragePreview(fileUrl, kind);
    if (tab && !tab.closed) {
      tab.location.replace(preview.url);
      if (preview.revokeOnCleanup) {
        window.setTimeout(() => URL.revokeObjectURL(preview.url), BLOB_URL_REVOKE_MS);
      }
      return true;
    }
    if (preview.revokeOnCleanup) URL.revokeObjectURL(preview.url);
    return Boolean(openBlobInNewTab(preview.blob));
  } catch (error) {
    closeHeldPreviewTab(`open:${fileUrl}`);
    throw error;
  }
}
