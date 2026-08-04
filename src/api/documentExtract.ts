import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import type { ExtractDocumentType } from "../lib/documentTypes";
import { normalizeDocumentExtractResult } from "../lib/documentTypes";
import { requireSupabase, supabaseAnonKey, supabaseUrl } from "../lib/supabase";
import { resolveStorageUrl } from "./vendors";

export type DocumentExtractResult = {
  configured: boolean;
  documentType?: ExtractDocumentType | null;
  documentTypeLabel?: string | null;
  summary?: string | null;
  name?: string | null;
  vendorName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  value?: number | null;
  autoRenew?: boolean | null;
  spendDate?: string | null;
  spendAmount?: number | null;
  spendDescription?: string | null;
  error?: string;
};

export type DocumentExtractStatus = {
  configured: boolean;
  error?: string;
  reachable?: boolean;
};

function parsePayload<T extends DocumentExtractResult>(data: unknown): T {
  const payload = data as T & { error?: string };
  if (payload?.error && payload.configured !== false) {
    throw new Error(payload.error);
  }
  return payload;
}

async function functionInvokeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    try {
      const payload = (await error.context.clone().json()) as { error?: string; message?: string };
      if (typeof payload?.error === "string" && payload.error.trim()) {
        return payload.error;
      }
      if (typeof payload?.message === "string" && payload.message.trim()) {
        return payload.message;
      }
    } catch {
      // Response body was not JSON.
    }

    if (error.context.status === 404) {
      return "AI document reading is not deployed. Run ./scripts/setup-document-extract.sh.";
    }
    if (error.context.status === 401) {
      return "Sign in again to use AI document reading.";
    }
    if (error.context.status === 403) {
      return "You do not have access to run AI document reading in this workspace.";
    }
  }

  if (error instanceof FunctionsFetchError) {
    return "Cannot reach Supabase edge functions. Check your connection and try again.";
  }

  if (error instanceof FunctionsRelayError) {
    return "Supabase could not run the document extraction function. Try again in a moment.";
  }

  if (error instanceof Error && error.message !== "Edge Function returned a non-2xx status code") {
    return error.message;
  }

  return "AI document reading request failed.";
}

async function invokeExtractDocument<T extends DocumentExtractResult>(
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke("extract-document", { body });

  if (error) {
    throw new Error(await functionInvokeErrorMessage(error));
  }

  if (data == null) {
    throw new Error("AI document reading returned an empty response.");
  }

  const payload = parsePayload<T>(data);
  if (body.mode === "extract" && typeof body.fileName === "string") {
    return normalizeDocumentExtractResult(payload as DocumentExtractResult, body.fileName) as T;
  }
  return payload;
}

export async function fetchDocumentExtractStatus(): Promise<DocumentExtractStatus> {
  const url = supabaseUrl?.trim();
  const apiKey = supabaseAnonKey?.trim();
  if (!url || !apiKey) {
    return {
      configured: false,
      reachable: false,
      error: "Supabase is not configured.",
    };
  }

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/extract-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ mode: "status" }),
    });

    if (response.status === 404) {
      return {
        configured: false,
        reachable: false,
        error: "AI document reading is not deployed. Run ./scripts/setup-document-extract.sh.",
      };
    }

    const payload = (await response.json()) as DocumentExtractStatus;
    if (!response.ok) {
      return {
        configured: false,
        reachable: false,
        error: payload?.error ?? "Could not reach AI document reading.",
      };
    }

    return {
      configured: Boolean(payload?.configured),
      error: payload?.error,
      reachable: true,
    };
  } catch (error) {
    return {
      configured: false,
      reachable: false,
      error: error instanceof Error ? error.message : "Could not reach AI document reading.",
    };
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export async function extractDocumentFromPdf(
  organizationId: string,
  file: File
): Promise<DocumentExtractResult> {
  if (!isPdfFile(file)) {
    throw new Error("Only PDF files can be read by AI.");
  }

  const fileBase64 = await fileToBase64(file);
  return invokeExtractDocument<DocumentExtractResult>({
    mode: "extract",
    organizationId,
    fileName: file.name,
    fileBase64,
  });
}

export async function extractDocumentFromUrl(
  organizationId: string,
  fileUrl: string,
  fileName: string
): Promise<DocumentExtractResult> {
  const url = await resolveStorageUrl(fileUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Could not download document for AI reading.");
  }
  const blob = await response.blob();
  const file = new File([blob], fileName, { type: blob.type || "application/pdf" });
  const result = await extractDocumentFromPdf(organizationId, file);
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
  return result;
}
