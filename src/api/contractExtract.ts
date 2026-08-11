import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import type { ExtractDocumentType } from "../lib/documentTypes";
import { parseFlexibleDate } from "../lib/documentTypes";
import { enrichContractExtractResult } from "../lib/contractExtractEnrich";
import { requireSupabase } from "../lib/supabase";

export type ContractExtractResult = {
  configured: boolean;
  name?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  renewalDate?: string | null;
  renewalType?: "fixed_term" | "auto_renew" | "month_to_month" | "evergreen" | null;
  noticePeriodDays?: number | null;
  termMonths?: number | null;
  value?: number | null;
  autoRenew?: boolean | null;
  documentType?: ExtractDocumentType | null;
  documentTypeLabel?: string | null;
  extractHints?: string[];
  error?: string;
};

export type ContractExtractStatus = {
  configured: boolean;
  error?: string;
  reachable?: boolean;
};

function parsePayload<T extends ContractExtractResult>(data: unknown): T {
  const payload = data as T & { error?: string };
  if (payload?.error && payload.configured !== false) {
    throw new Error(payload.error);
  }
  return payload;
}

function normalizeContractExtractResult(result: ContractExtractResult): ContractExtractResult {
  const parsed: ContractExtractResult = {
    ...result,
    startDate: parseFlexibleDate(result.startDate) ?? result.startDate ?? null,
    endDate: parseFlexibleDate(result.endDate) ?? result.endDate ?? null,
    renewalDate: parseFlexibleDate(result.renewalDate) ?? result.renewalDate ?? null,
  };
  return enrichContractExtractResult(parsed);
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
      return "AI extraction is not deployed. Run ./scripts/setup-contract-extract.sh.";
    }
    if (error.context.status === 401) {
      return "Sign in again to use AI extraction.";
    }
    if (error.context.status === 403) {
      return "You do not have access to run AI extraction in this workspace.";
    }
  }

  if (error instanceof FunctionsFetchError) {
    return "Cannot reach Supabase edge functions. Check your connection and try again.";
  }

  if (error instanceof FunctionsRelayError) {
    return "Supabase could not run the extraction function. Try again in a moment.";
  }

  if (error instanceof Error && error.message !== "Edge Function returned a non-2xx status code") {
    return error.message;
  }

  return "AI extraction request failed.";
}

function errorFromInvokePayload(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as { error?: string; message?: string };
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  return null;
}

async function invokeExtractContract<T extends ContractExtractResult>(
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke("extract-contract", { body });

  if (error) {
    const payloadMessage = errorFromInvokePayload(data);
    if (payloadMessage) {
      throw new Error(payloadMessage);
    }
    throw new Error(await functionInvokeErrorMessage(error));
  }

  if (data == null) {
    throw new Error("AI extraction returned an empty response.");
  }

  return parsePayload<T>(data);
}

export async function fetchContractExtractStatus(): Promise<ContractExtractStatus> {
  const {
    data: { session },
  } = await requireSupabase().auth.getSession();

  if (!session) {
    return {
      configured: false,
      reachable: false,
      error: "Sign in to check AI extraction status.",
    };
  }

  try {
    const { data, error } = await requireSupabase().functions.invoke("extract-contract", {
      body: { mode: "status" },
    });

    if (error) {
      return {
        configured: false,
        reachable: false,
        error: await functionInvokeErrorMessage(error),
      };
    }

    const payload = data as ContractExtractStatus;
    return {
      configured: Boolean(payload?.configured),
      error: payload?.error,
      reachable: true,
    };
  } catch (error) {
    return {
      configured: false,
      reachable: false,
      error: error instanceof Error ? error.message : "Could not reach AI extraction.",
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

export async function extractContractFromPdf(
  organizationId: string,
  file: File
): Promise<ContractExtractResult> {
  if (!isPdfFile(file)) {
    throw new Error("Only PDF files can be read by AI.");
  }

  const fileBase64 = await fileToBase64(file);
  const result = await invokeExtractContract<ContractExtractResult>({
    mode: "extract",
    organizationId,
    fileName: file.name,
    fileBase64,
  });
  return normalizeContractExtractResult(result);
}
