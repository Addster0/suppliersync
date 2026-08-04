import type { DocumentExtractResult } from "../api/documentExtract";
import type { DocumentDocType } from "../types";

/** Document categories returned by the extract-document edge function. */
export const EXTRACT_DOCUMENT_TYPES = [
  "receipt",
  "invoice",
  "memo",
  "service_agreement",
  "baa",
  "coi",
  "w9",
  "other",
] as const;

export type ExtractDocumentType = (typeof EXTRACT_DOCUMENT_TYPES)[number];

const EXTRACT_DOCUMENT_TYPE_LABELS: Record<ExtractDocumentType, string> = {
  receipt: "Receipt",
  invoice: "Invoice",
  memo: "Memo",
  service_agreement: "Service Agreement",
  baa: "Business Associate Agreement (BAA)",
  coi: "Certificate of Insurance (COI)",
  w9: "W-9 / Tax Form",
  other: "Other Document",
};

export type SpendPrefill = {
  date: string;
  description: string;
  amount: string;
  sourceFileName: string;
};

export function extractDocumentTypeLabel(documentType: ExtractDocumentType | string | null | undefined): string | null {
  if (!documentType) return null;
  if (documentType in EXTRACT_DOCUMENT_TYPE_LABELS) {
    return EXTRACT_DOCUMENT_TYPE_LABELS[documentType as ExtractDocumentType];
  }
  return null;
}

export function isExtractDocumentType(value: unknown): value is ExtractDocumentType {
  return typeof value === "string" && EXTRACT_DOCUMENT_TYPES.includes(value as ExtractDocumentType);
}

/** Map AI document type to the app's compliance document dropdown values. */
export function mapExtractDocumentTypeToDocType(documentType: ExtractDocumentType | null | undefined): DocumentDocType {
  switch (documentType) {
    case "coi":
      return "coi";
    case "w9":
      return "w9";
    default:
      return "general";
  }
}

/** True when the extracted type is a contract/agreement rather than a compliance doc. */
export function isContractLikeDocumentType(documentType: ExtractDocumentType | null | undefined): boolean {
  return documentType === "service_agreement" || documentType === "baa";
}

/** True when AI detected a receipt or invoice suitable for spend tracking. */
export function isSpendDocumentType(documentType: ExtractDocumentType | null | undefined): boolean {
  return documentType === "receipt" || documentType === "invoice";
}

/** True when AI detected a memo or general informational document. */
export function isMemoDocumentType(documentType: ExtractDocumentType | null | undefined): boolean {
  return documentType === "memo" || documentType === "other";
}

const SPEND_FILENAME_PATTERN = /\b(invoice|receipt|bill|statement|payment|paid|purchase)\b/i;

export function filenameSuggestsSpend(fileName: string): boolean {
  return SPEND_FILENAME_PATTERN.test(fileName);
}

/** Parse common date strings into YYYY-MM-DD for spend/contract fields. */
export function parseFlexibleDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const isoPrefix = trimmed.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoPrefix) return isoPrefix[1];

  const usMatch = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (usMatch) {
    const month = usMatch[1].padStart(2, "0");
    const day = usMatch[2].padStart(2, "0");
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    return `${year}-${month}-${day}`;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return null;
}

export function parseExtractAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return null;

    const cleaned = normalized.replace(/[^0-9.,-]/g, "");
    if (!cleaned) return null;

    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    let numeric = cleaned;

    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) {
        numeric = cleaned.replace(/\./g, "").replace(",", ".");
      } else {
        numeric = cleaned.replace(/,/g, "");
      }
    } else if (lastComma > -1) {
      const parts = cleaned.split(",");
      numeric = parts.length === 2 && parts[1].length <= 2 ? `${parts[0]}.${parts[1]}` : cleaned.replace(/,/g, "");
    }

    const parsed = Number(numeric);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function hasSpendFields(result: Pick<DocumentExtractResult, "spendAmount" | "spendDate" | "value">): boolean {
  const amount = result.spendAmount ?? result.value;
  return (amount != null && amount > 0) || Boolean(result.spendDate);
}

/** Infer receipt/invoice when AI mislabels a spend document. */
export function inferSpendDocumentType(
  result: Pick<DocumentExtractResult, "documentType" | "spendAmount" | "spendDate" | "value" | "endDate" | "startDate">,
  fileName: string
): ExtractDocumentType | null {
  if (result.documentType && isSpendDocumentType(result.documentType)) return result.documentType;
  if (isContractLikeDocumentType(result.documentType)) return null;

  const amount = result.spendAmount ?? result.value;
  const hasAmount = amount != null && Number.isFinite(amount) && amount > 0;
  const filenameHint = filenameSuggestsSpend(fileName);

  if (hasAmount && (filenameHint || result.spendDate || result.spendAmount != null)) {
    return /\breceipt\b/i.test(fileName) ? "receipt" : "invoice";
  }

  if (hasSpendFields(result) && !result.endDate && filenameHint) {
    return /\breceipt\b/i.test(fileName) ? "receipt" : "invoice";
  }

  return null;
}

function buildSpendDescription(
  result: Pick<DocumentExtractResult, "spendDescription" | "name" | "summary" | "vendorName">,
  fileName: string,
  vendorName?: string
): string {
  if (result.spendDescription?.trim()) return result.spendDescription.trim();

  const parts: string[] = [];
  if (result.vendorName?.trim()) parts.push(result.vendorName.trim());
  else if (vendorName?.trim()) parts.push(vendorName.trim());

  if (result.name?.trim()) {
    const name = result.name.trim();
    if (!parts.some((part) => part.toLowerCase() === name.toLowerCase())) {
      parts.push(name);
    }
  } else if (result.summary?.trim()) {
    parts.push(result.summary.trim().slice(0, 100));
  }

  if (parts.length === 0) {
    parts.push(fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim());
  }

  return parts.join(" — ");
}

/** Build spend prefill from AI extraction; returns null when amount is missing. */
export function buildSpendPrefill(
  result: DocumentExtractResult,
  fileName: string,
  vendorName?: string
): SpendPrefill | null {
  const spendType = inferSpendDocumentType(result, fileName);
  if (!spendType && !hasSpendFields(result)) return null;
  if (isContractLikeDocumentType(result.documentType) && !result.spendAmount && !result.spendDate) {
    return null;
  }

  const amount = result.spendAmount ?? result.value;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;

  const date =
    parseFlexibleDate(result.spendDate) ??
    parseFlexibleDate(result.startDate) ??
    new Date().toISOString().slice(0, 10);

  return {
    date,
    description: buildSpendDescription(result, fileName, vendorName),
    amount: String(amount),
    sourceFileName: fileName,
  };
}

/** Client-side normalization after edge function response. */
export function normalizeDocumentExtractResult(
  result: DocumentExtractResult,
  fileName: string
): DocumentExtractResult {
  const spendDate = parseFlexibleDate(result.spendDate) ?? result.spendDate ?? null;
  const startDate = parseFlexibleDate(result.startDate) ?? result.startDate ?? null;
  const endDate = parseFlexibleDate(result.endDate) ?? result.endDate ?? null;
  const spendAmount = parseExtractAmount(result.spendAmount) ?? result.spendAmount ?? null;
  const value = parseExtractAmount(result.value) ?? result.value ?? null;

  let documentType = result.documentType ?? null;
  const inferredType = inferSpendDocumentType(
    { documentType, spendAmount, spendDate, value, endDate, startDate },
    fileName
  );
  if (inferredType) documentType = inferredType;

  const normalizedSpendAmount = spendAmount ?? (isSpendDocumentType(documentType) ? value : null);
  const normalizedSpendDate =
    spendDate ?? (isSpendDocumentType(documentType) && startDate ? startDate : null);

  return {
    ...result,
    documentType,
    documentTypeLabel:
      result.documentTypeLabel ?? extractDocumentTypeLabel(documentType) ?? result.documentTypeLabel,
    startDate,
    endDate,
    value,
    spendAmount: normalizedSpendAmount,
    spendDate: normalizedSpendDate,
  };
}
