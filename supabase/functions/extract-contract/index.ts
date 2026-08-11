import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkAndLogExtractUsage } from "../_shared/apiUsageLimit.ts";
import { requireAuthenticatedUser } from "../_shared/requireAuthenticated.ts";
import { extractContractFromPdf } from "./contractExtractCore.ts";

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

function isPdfBase64(fileBase64: string): boolean {
  try {
    const binary = atob(fileBase64.slice(0, 12));
    return binary.startsWith("%PDF-");
  } catch {
    return false;
  }
}

function normalizeDocumentType(value: string | null): ExtractDocumentType | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((EXTRACT_DOCUMENT_TYPES as readonly string[]).includes(normalized)) {
    return normalized as ExtractDocumentType;
  }
  return null;
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

  const rateLimit = await checkAndLogExtractUsage(access.user.id, organizationId, "extract-contract");
  if (!rateLimit.allowed) {
    return jsonResponse({ error: rateLimit.message }, rateLimit.status);
  }

  try {
    const extracted = await extractContractFromPdf({
      apiKey: openaiKey,
      fileName,
      fileBase64,
    });

    const documentType = normalizeDocumentType(extracted.documentType);
    const documentTypeLabel =
      extracted.documentTypeLabel?.trim() ||
      (documentType ? EXTRACT_DOCUMENT_TYPE_LABELS[documentType] : null);

    return jsonResponse({
      configured: true,
      name: extracted.name,
      startDate: extracted.startDate,
      endDate: extracted.endDate,
      renewalDate: extracted.renewalDate,
      renewalType: extracted.renewalType,
      noticePeriodDays: extracted.noticePeriodDays,
      termMonths: extracted.termMonths,
      value: extracted.value,
      autoRenew: extracted.autoRenew,
      documentType,
      documentTypeLabel,
      extractHints: extracted.extractHints,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Contract extraction failed.";
    return jsonResponse({ configured: true, error: message }, 502);
  }
});
