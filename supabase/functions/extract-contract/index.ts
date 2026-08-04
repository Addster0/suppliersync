import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  "service_agreement",
  "baa",
  "coi",
  "w9",
  "invoice",
  "other",
] as const;

type ExtractDocumentType = (typeof EXTRACT_DOCUMENT_TYPES)[number];

const EXTRACT_DOCUMENT_TYPE_LABELS: Record<ExtractDocumentType, string> = {
  service_agreement: "Service Agreement",
  baa: "Business Associate Agreement (BAA)",
  coi: "Certificate of Insurance (COI)",
  w9: "W-9 / Tax Form",
  invoice: "Invoice",
  other: "Other Document",
};

type ExtractedContract = {
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  renewalType: "fixed_term" | "auto_renew" | "month_to_month" | "evergreen" | null;
  noticePeriodDays: number | null;
  termMonths: number | null;
  value: number | null;
  autoRenew: boolean | null;
  documentType: ExtractDocumentType | null;
  documentTypeLabel: string | null;
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
      "Add OPENAI_API_KEY to Supabase edge function secrets to enable AI extraction. Run scripts/setup-contract-extract.sh.",
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

function parseRenewalType(value: unknown): ExtractedContract["renewalType"] {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const allowed = ["fixed_term", "auto_renew", "month_to_month", "evergreen"] as const;
  return (allowed as readonly string[]).includes(normalized)
    ? (normalized as ExtractedContract["renewalType"])
    : null;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return null;
}

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
  }
  return null;
}

function normalizeExtracted(raw: Record<string, unknown>): ExtractedContract {
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null;
  const startDate = parseFlexibleDate(raw.startDate);
  const endDate = parseFlexibleDate(raw.endDate);
  const renewalDate = parseFlexibleDate(raw.renewalDate);

  let value: number | null = null;
  if (typeof raw.value === "number" && Number.isFinite(raw.value) && raw.value >= 0) {
    value = raw.value;
  } else if (typeof raw.value === "string") {
    const parsed = Number(raw.value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) value = parsed;
  }

  let autoRenew: boolean | null = null;
  if (typeof raw.autoRenew === "boolean") {
    autoRenew = raw.autoRenew;
  }

  let renewalType = parseRenewalType(raw.renewalType);
  if (!renewalType && autoRenew === true) renewalType = "auto_renew";
  if (!renewalType && autoRenew === false && !endDate) renewalType = "evergreen";
  if (!renewalType && endDate) renewalType = "fixed_term";

  const noticePeriodDays = parseNonNegativeInt(raw.noticePeriodDays);
  const termMonths = parsePositiveInt(raw.termMonths);

  let documentType: ExtractDocumentType | null = null;
  if (typeof raw.documentType === "string") {
    const normalized = raw.documentType.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if ((EXTRACT_DOCUMENT_TYPES as readonly string[]).includes(normalized)) {
      documentType = normalized as ExtractDocumentType;
    }
  }

  let documentTypeLabel: string | null = null;
  if (typeof raw.documentTypeLabel === "string" && raw.documentTypeLabel.trim()) {
    documentTypeLabel = raw.documentTypeLabel.trim();
  } else if (documentType) {
    documentTypeLabel = EXTRACT_DOCUMENT_TYPE_LABELS[documentType];
  }

  return {
    name,
    startDate,
    endDate,
    renewalDate,
    renewalType,
    noticePeriodDays,
    termMonths,
    value,
    autoRenew,
    documentType,
    documentTypeLabel,
  };
}

const EXTRACTION_PROMPT = `Extract document metadata from this PDF. Return JSON only with these keys:
- name: document or contract title (string or null)
- startDate: start or effective date as YYYY-MM-DD (string or null)
- endDate: fixed term end or current term expiry as YYYY-MM-DD (string or null). Use null for evergreen/month-to-month with no fixed end.
- renewalDate: review or notice deadline as YYYY-MM-DD (string or null). For auto-renew contracts, this is when notice must be given (e.g. 90 days before renewal).
- renewalType: one of "fixed_term", "auto_renew", "month_to_month", "evergreen"
- noticePeriodDays: days of advance notice required to cancel or non-renew (integer or null, e.g. 90)
- termMonths: initial or renewal term length in months (integer or null, e.g. 12)
- value: contract or invoice amount in USD as a number without currency symbols (number or null)
- autoRenew: true if the agreement auto-renews, false if it does not, null if unclear (legacy — prefer renewalType)
- documentType: one of "service_agreement", "baa", "coi", "w9", "invoice", "other"
- documentTypeLabel: human-readable label for documentType (e.g. "Service Agreement", "Certificate of Insurance (COI)")

Renewal type guidance:
- fixed_term: agreement ends on a specific date with no automatic renewal
- auto_renew: renews unless notice is given (look for "automatically renew", "evergreen unless terminated", "successive terms")
- month_to_month: cancellable on short notice, no long fixed term
- evergreen: ongoing with no fixed end date

Document type guidance:
- service_agreement: vendor/service contracts, MSAs, SOWs, subscription agreements
- baa: business associate agreements, HIPAA BAAs
- coi: certificates of insurance, liability insurance proofs
- w9: IRS W-9 or tax withholding forms
- invoice: invoices, bills, statements of charges
- other: anything else

Use null when a field cannot be determined confidently. Prefer explicit term or expiry dates over signature dates. If auto-renewing with a notice period and term length, compute renewalDate as the notice deadline before the next renewal when possible.`;

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
}): Promise<ExtractedContract> {
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
            "You extract structured metadata from vendor PDF documents (contracts, compliance forms, invoices). Respond with valid JSON only.",
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

  return normalizeExtracted(parsed);
}

async function requireOrgMember(req: Request, organizationId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return { error: jsonResponse({ error: "Supabase environment is not configured." }, 500) };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: jsonResponse({ error: "Unauthorized." }, 401) };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return { error: jsonResponse({ error: "Unauthorized." }, 401) };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return { error: jsonResponse({ error: membershipError.message }, 500) };
  }

  if (!membership) {
    return { error: jsonResponse({ error: "You do not have access to this workspace." }, 403) };
  }

  return { user };
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

  const fileName = body.fileName?.trim() || "contract.pdf";
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
    const message = error instanceof Error ? error.message : "Contract extraction failed.";
    return jsonResponse({ configured: true, error: message }, 502);
  }
});
