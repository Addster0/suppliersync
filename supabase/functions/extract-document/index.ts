import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkAndLogExtractUsage } from "../_shared/apiUsageLimit.ts";
import { requireAuthenticatedUser } from "../_shared/requireAuthenticated.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_BASE64_CHARS = 6 * 1024 * 1024;

type ExtractPayload = {
  mode?: "status" | "extract";
  organizationId?: string;
  fileBase64?: string;
  fileName?: string;
};

const EXTRACT_DOCUMENT_TYPES = [
  "receipt",
  "invoice",
  "memo",
  "service_agreement",
  "baa",
  "coi",
  "w9",
  "other",
] as const;

type ExtractDocumentType = (typeof EXTRACT_DOCUMENT_TYPES)[number];

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

type ExtractedDocument = {
  documentType: ExtractDocumentType | null;
  documentTypeLabel: string | null;
  summary: string | null;
  name: string | null;
  vendorName: string | null;
  startDate: string | null;
  endDate: string | null;
  value: number | null;
  autoRenew: boolean | null;
  spendDate: string | null;
  spendAmount: number | null;
  spendDescription: string | null;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function notConfiguredResponse() {
  return jsonResponse({
    configured: false,
    error:
      "Add OPENAI_API_KEY to Supabase edge function secrets to enable AI extraction. Run scripts/setup-document-extract.sh.",
  });
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseFlexibleDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (isIsoDate(trimmed)) return trimmed;

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

function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[^0-9.,-]/g, "");
    if (!cleaned) return null;

    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    let numeric = cleaned;

    if (lastComma > -1 && lastDot > -1) {
      numeric = lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
    } else if (lastComma > -1) {
      const parts = cleaned.split(",");
      numeric = parts.length === 2 && parts[1].length <= 2
        ? `${parts[0]}.${parts[1]}`
        : cleaned.replace(/,/g, "");
    }

    const parsed = Number(numeric);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function filenameSuggestsSpend(fileName: string): boolean {
  return /\b(invoice|receipt|bill|statement|payment|paid|purchase)\b/i.test(fileName);
}

function normalizeExtracted(raw: Record<string, unknown>, fileName: string): ExtractedDocument {
  let documentType: ExtractDocumentType | null = null;
  if (typeof raw.documentType === "string") {
    const normalized = raw.documentType.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if ((EXTRACT_DOCUMENT_TYPES as readonly string[]).includes(normalized)) {
      documentType = normalized as ExtractDocumentType;
    } else if (/receipt|paid/.test(normalized)) {
      documentType = "receipt";
    } else if (/invoice|bill|statement/.test(normalized)) {
      documentType = "invoice";
    }
  }

  let documentTypeLabel: string | null = null;
  if (typeof raw.documentTypeLabel === "string" && raw.documentTypeLabel.trim()) {
    documentTypeLabel = raw.documentTypeLabel.trim();
  } else if (documentType) {
    documentTypeLabel = EXTRACT_DOCUMENT_TYPE_LABELS[documentType];
  }

  const summary =
    typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null;
  const vendorName =
    typeof raw.vendorName === "string" && raw.vendorName.trim() ? raw.vendorName.trim() : null;
  const startDate = parseFlexibleDate(raw.startDate);
  const endDate = parseFlexibleDate(raw.endDate);
  const value = parseAmount(raw.value);

  let autoRenew: boolean | null = null;
  if (typeof raw.autoRenew === "boolean") {
    autoRenew = raw.autoRenew;
  }

  let spendDate = parseFlexibleDate(raw.spendDate);
  let spendAmount = parseAmount(raw.spendAmount);
  let spendDescription =
    typeof raw.spendDescription === "string" && raw.spendDescription.trim()
      ? raw.spendDescription.trim()
      : null;

  const isSpendType = documentType === "receipt" || documentType === "invoice";
  if (isSpendType) {
    if (spendAmount == null && value != null) spendAmount = value;
    if (spendDate == null && startDate) spendDate = startDate;
    if (!spendDescription) {
      const parts = [vendorName, name].filter(Boolean) as string[];
      if (parts.length > 0) spendDescription = parts.join(" — ");
    }
  }

  const hasSpendData = spendAmount != null || spendDate != null;
  if (!isSpendType && hasSpendData && !endDate && filenameSuggestsSpend(fileName)) {
    documentType = /\breceipt\b/i.test(fileName) ? "receipt" : "invoice";
    documentTypeLabel = EXTRACT_DOCUMENT_TYPE_LABELS[documentType];
    if (spendAmount == null && value != null) spendAmount = value;
  }

  return {
    documentType,
    documentTypeLabel,
    summary,
    name,
    vendorName,
    startDate,
    endDate,
    value,
    autoRenew,
    spendDate,
    spendAmount,
    spendDescription,
  };
}

const EXTRACTION_PROMPT = `Extract structured metadata from this PDF document. Return JSON only with these keys:

- documentType: one of "receipt", "invoice", "memo", "service_agreement", "baa", "coi", "w9", "other"
- documentTypeLabel: human-readable label for documentType
- summary: 1-3 sentence plain-language summary of key information (string or null). Required for memo/other; optional for others.
- name: document title, invoice number, or primary line item (string or null)
- vendorName: company or vendor name shown on the document (string or null)
- startDate: start or effective date as YYYY-MM-DD (string or null)
- endDate: end, expiry, or renewal date as YYYY-MM-DD (string or null)
- value: contract or total amount in USD as a number without currency symbols (number or null)
- autoRenew: true if the agreement auto-renews, false if it does not, null if unclear or not applicable
- spendDate: payment, invoice, or transaction date as YYYY-MM-DD for receipts/invoices (string or null)
- spendAmount: total paid or amount due in USD for receipts/invoices — use the final total including tax (number or null)
- spendDescription: short spend ledger description combining vendorName + service/product, e.g. "Acme Corp — monthly SaaS subscription" (string or null)

Document type guidance (choose the best match):
- receipt: payment receipts, proof of purchase, paid invoices, credit card receipts, transaction confirmations
- invoice: bills, statements of charges, unpaid or payable invoices, vendor invoices
- memo: internal memos, letters, notes, correspondence without financial or contract terms
- service_agreement: vendor/service contracts, MSAs, SOWs, subscription agreements with term dates
- baa: business associate agreements, HIPAA BAAs
- coi: certificates of insurance, liability insurance proofs
- w9: IRS W-9 or tax withholding forms
- other: anything else

IMPORTANT for receipts and invoices:
1. Always set documentType to "receipt" or "invoice" — never "other" for bills or payment documents.
2. Always populate spendAmount with the document total (numbers only, no $ or commas).
3. Always populate spendDate with the invoice/payment date in YYYY-MM-DD format.
4. Always populate spendDescription with vendorName plus the main service or product.
5. Put the same total in value only if no separate contract value exists.

For contracts and agreements, prioritize name, startDate, endDate, value, autoRenew.
For memos, prioritize summary.
Use null when a field cannot be determined confidently. Prefer explicit invoice/payment dates over due dates.`;

function isPdfBase64(fileBase64: string): boolean {
  try {
    const binary = atob(fileBase64.slice(0, 12));
    return binary.startsWith("%PDF-");
  } catch {
    return false;
  }
}

async function extractWithOpenAI(params: {
  apiKey: string;
  fileName: string;
  fileBase64: string;
}): Promise<ExtractedDocument> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract structured metadata from vendor PDF documents (receipts, invoices, memos, contracts, compliance forms). Respond with valid JSON only.",
        },
        {
          role: "user",
          content: [
            {
              type: "file",
              file: {
                filename: params.fileName,
                file_data: `data:application/pdf;base64,${params.fileBase64}`,
              },
            },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    let message = await response.text();
    try {
      const parsed = JSON.parse(message) as { error?: { message?: string } };
      message = parsed.error?.message ?? message;
    } catch {
      // Keep raw response text when OpenAI does not return JSON.
    }
    throw new Error(`OpenAI error (${response.status}): ${message}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("OpenAI returned invalid JSON.");
  }

  return normalizeExtracted(parsed, params.fileName);
}

async function requireOrgMember(req: Request, organizationId: string) {
  const auth = await requireAuthenticatedUser(req, corsHeaders, jsonResponse);
  if ("error" in auth && auth.error) {
    return { error: auth.error };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return { error: jsonResponse({ error: "Supabase environment is not configured." }, 500) };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (membershipError) {
    return { error: jsonResponse({ error: membershipError.message }, 500) };
  }

  if (!membership) {
    return { error: jsonResponse({ error: "You do not have access to this workspace." }, 403) };
  }

  return { user: auth.user };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let body: ExtractPayload;
  try {
    body = (await req.json()) as ExtractPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const mode = body.mode ?? "extract";
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (mode === "status") {
    const auth = await requireAuthenticatedUser(req, corsHeaders, jsonResponse);
    if ("error" in auth && auth.error) return auth.error;

    return jsonResponse({
      configured: Boolean(openaiKey),
      error: openaiKey
        ? undefined
        : "Add OPENAI_API_KEY to Supabase edge function secrets to enable AI extraction.",
    });
  }

  if (!openaiKey) {
    return notConfiguredResponse();
  }

  const organizationId = body.organizationId?.trim();
  if (!organizationId) {
    return jsonResponse({ error: "organizationId is required." }, 400);
  }

  const access = await requireOrgMember(req, organizationId);
  if ("error" in access && access.error) {
    return access.error;
  }

  const fileName = body.fileName?.trim() || "document.pdf";
  const fileBase64 = body.fileBase64?.trim();
  if (!fileBase64) {
    return jsonResponse({ error: "fileBase64 is required." }, 400);
  }

  if (fileBase64.length > MAX_BASE64_CHARS) {
    return jsonResponse({ error: "PDF is too large for AI extraction (max 4 MB)." }, 400);
  }

  const lowerName = fileName.toLowerCase();
  if (!lowerName.endsWith(".pdf")) {
    return jsonResponse({ error: "Only PDF files are supported for AI extraction." }, 400);
  }

  if (!isPdfBase64(fileBase64)) {
    return jsonResponse({ error: "File content is not a valid PDF." }, 400);
  }

  const rateLimit = await checkAndLogExtractUsage(access.user.id, organizationId, "extract-document");
  if (!rateLimit.allowed) {
    return jsonResponse({ error: rateLimit.message }, rateLimit.status);
  }

  try {
    const extracted = await extractWithOpenAI({
      apiKey: openaiKey,
      fileName,
      fileBase64,
    });

    return jsonResponse({
      configured: true,
      ...extracted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document extraction failed.";
    return jsonResponse({ configured: true, error: message }, 502);
  }
});
