/** Shared contract PDF extraction helpers (edge function). */

export type ExtractedContract = {
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  renewalType: "fixed_term" | "auto_renew" | "month_to_month" | "evergreen" | null;
  noticePeriodDays: number | null;
  termMonths: number | null;
  value: number | null;
  autoRenew: boolean | null;
  documentType: string | null;
  documentTypeLabel: string | null;
  extractHints: string[];
};

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function formatDateForQuery(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseFlexibleDate(value: unknown): string | null {
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

  const monthDayYear = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthDayYear) {
    const month = MONTHS[monthDayYear[1].toLowerCase()];
    if (month) {
      return `${monthDayYear[3]}-${String(month).padStart(2, "0")}-${monthDayYear[2].padStart(2, "0")}`;
    }
  }

  const dayMonthYear = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dayMonthYear) {
    const month = MONTHS[dayMonthYear[2].toLowerCase()];
    if (month) {
      return `${dayMonthYear[3]}-${String(month).padStart(2, "0")}-${dayMonthYear[1].padStart(2, "0")}`;
    }
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return formatDateForQuery(new Date(parsed));
  }

  return null;
}

function pickRawDate(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const parsed = parseFlexibleDate(raw[key]);
    if (parsed) return parsed;
  }
  return null;
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

export function parseTermMonthsFromText(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const lower = value.toLowerCase();

  const yearMatch = lower.match(/(\d+)\s*(?:-\s*)?year/);
  if (yearMatch) return Number(yearMatch[1]) * 12;

  const monthMatch = lower.match(/(\d+)\s*(?:-\s*)?month/);
  if (monthMatch) return Number(monthMatch[1]);

  if (/\b(one|1)\s*\(\s*1\s*\)\s*year\b/.test(lower) || /\b(one|1)\s+year\b/.test(lower)) return 12;
  if (/\b(two|2)\s+years?\b/.test(lower)) return 24;
  if (/\b(three|3)\s+years?\b/.test(lower)) return 36;

  return null;
}

function pickTermMonths(raw: Record<string, unknown>): number | null {
  const keys = ["termMonths", "term_months", "termLength", "term_length", "initialTerm", "initial_term", "term"];
  for (const key of keys) {
    const fromInt = parsePositiveInt(raw[key]);
    if (fromInt) return fromInt;
    const fromText = parseTermMonthsFromText(raw[key]);
    if (fromText) return fromText;
  }
  return parseTermMonthsFromText(raw.termDescription) ?? parseTermMonthsFromText(raw.duration);
}

function parseRenewalType(value: unknown): ExtractedContract["renewalType"] {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const allowed = ["fixed_term", "auto_renew", "month_to_month", "evergreen"] as const;
  return (allowed as readonly string[]).includes(normalized)
    ? (normalized as ExtractedContract["renewalType"])
    : null;
}

function monthsBetweenIsoDates(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(1, months);
}

export function addMonthsToIsoDate(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return formatDateForQuery(date);
}

function subtractDaysFromIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() - days);
  return formatDateForQuery(date);
}

export function enrichExtracted(extracted: ExtractedContract): ExtractedContract {
  const enriched: ExtractedContract = { ...extracted, extractHints: [...extracted.extractHints] };

  if (!enriched.name?.trim() && enriched.documentTypeLabel?.trim()) {
    enriched.name = enriched.documentTypeLabel.trim();
  }

  if (enriched.termMonths == null && enriched.startDate && enriched.endDate) {
    enriched.termMonths = monthsBetweenIsoDates(enriched.startDate, enriched.endDate);
  }

  if (!enriched.endDate && enriched.startDate && enriched.termMonths != null && enriched.termMonths > 0) {
    enriched.endDate = addMonthsToIsoDate(enriched.startDate, enriched.termMonths);
  }

  if (!enriched.renewalType) {
    if (enriched.autoRenew === true) enriched.renewalType = "auto_renew";
    else if (enriched.endDate) enriched.renewalType = "fixed_term";
    else if (enriched.autoRenew === false) enriched.renewalType = "evergreen";
  }

  if (
    !enriched.endDate &&
    enriched.startDate &&
    !enriched.termMonths &&
    enriched.renewalType !== "evergreen" &&
    enriched.renewalType !== "month_to_month"
  ) {
    enriched.termMonths = 12;
    enriched.endDate = addMonthsToIsoDate(enriched.startDate, 12);
    if (!enriched.renewalType) enriched.renewalType = "fixed_term";
    enriched.extractHints.push("End date estimated as 12 months from start — verify against the PDF.");
  }

  if (!enriched.renewalDate && enriched.renewalType === "auto_renew") {
    if (enriched.endDate && enriched.noticePeriodDays != null && enriched.noticePeriodDays >= 0) {
      enriched.renewalDate = subtractDaysFromIsoDate(enriched.endDate, enriched.noticePeriodDays);
    } else if (enriched.startDate && enriched.termMonths != null && enriched.termMonths > 0) {
      enriched.renewalDate = subtractDaysFromIsoDate(
        addMonthsToIsoDate(enriched.startDate, enriched.termMonths),
        enriched.noticePeriodDays ?? 0,
      );
    } else if (enriched.endDate) {
      enriched.renewalDate = enriched.endDate;
    }
  }

  if (enriched.renewalType === "fixed_term" && !enriched.endDate && enriched.startDate && enriched.termMonths) {
    enriched.endDate = addMonthsToIsoDate(enriched.startDate, enriched.termMonths);
  }

  return enriched;
}

export function normalizeExtracted(raw: Record<string, unknown>): ExtractedContract {
  const startDate = pickRawDate(raw, [
    "startDate",
    "start_date",
    "effectiveDate",
    "effective_date",
    "commencementDate",
    "termStart",
    "term_start",
    "beginDate",
    "initialTermStart",
  ]);
  const endDate = pickRawDate(raw, [
    "endDate",
    "end_date",
    "expirationDate",
    "expiration_date",
    "expiryDate",
    "termEnd",
    "term_end",
    "terminationDate",
  ]);
  const renewalDate = pickRawDate(raw, [
    "renewalDate",
    "renewal_date",
    "reviewDate",
    "noticeDeadline",
    "renewal_deadline",
  ]);

  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : typeof raw.contractName === "string" && raw.contractName.trim()
          ? raw.contractName.trim()
          : null;

  let value: number | null = null;
  if (typeof raw.value === "number" && Number.isFinite(raw.value) && raw.value >= 0) {
    value = raw.value;
  } else if (typeof raw.value === "string") {
    const parsed = Number(raw.value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) value = parsed;
  } else if (typeof raw.contractValue === "number") {
    value = raw.contractValue as number;
  }

  let autoRenew: boolean | null = null;
  if (typeof raw.autoRenew === "boolean") autoRenew = raw.autoRenew;
  else if (typeof raw.auto_renew === "boolean") autoRenew = raw.auto_renew;

  let renewalType = parseRenewalType(raw.renewalType ?? raw.renewal_type);
  if (!renewalType && autoRenew === true) renewalType = "auto_renew";
  if (!renewalType && autoRenew === false && !endDate) renewalType = "evergreen";
  if (!renewalType && endDate) renewalType = "fixed_term";

  const noticePeriodDays =
    parseNonNegativeInt(raw.noticePeriodDays) ?? parseNonNegativeInt(raw.notice_period_days);
  const termMonths = pickTermMonths(raw);

  let documentType: string | null = null;
  if (typeof raw.documentType === "string") {
    documentType = raw.documentType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  let documentTypeLabel: string | null = null;
  if (typeof raw.documentTypeLabel === "string" && raw.documentTypeLabel.trim()) {
    documentTypeLabel = raw.documentTypeLabel.trim();
  }

  return enrichExtracted({
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
    extractHints: [],
  });
}

export function needsDateSecondPass(extracted: ExtractedContract): boolean {
  return !extracted.startDate || !extracted.endDate;
}

export const FULL_EXTRACTION_PROMPT = `Extract document metadata from this PDF. Return JSON only with these keys:
- name: document or contract title (string or null)
- startDate: start/effective date as YYYY-MM-DD (also accept writing effectiveDate if easier)
- endDate: expiration/term end as YYYY-MM-DD (also expirationDate)
- renewalDate: review or notice deadline as YYYY-MM-DD (optional)
- renewalType: fixed_term | auto_renew | month_to_month | evergreen
- noticePeriodDays: integer or null
- termMonths: term length in months (integer or null) — parse "12 months", "1 year", "36-month term"
- value: USD number without symbols
- autoRenew: boolean or null
- documentType: service_agreement | baa | coi | w9 | invoice | other
- documentTypeLabel: human-readable type label

CRITICAL — dates are required for the app to save contracts:
1. Scan every page for Effective Date, Commencement, Term, Expiration, Expires, Through, Until, Initial Term, Renewal.
2. Return startDate AND endDate whenever any term language exists.
3. If you find a term length (e.g. "12 months from Effective Date") and startDate, compute endDate.
4. Use YYYY-MM-DD only. Convert "January 15, 2026" → "2026-01-15".
5. Prefer agreement term dates over signature dates.

Use null only if truly absent after scanning the full document.`;

export const DATE_FOCUS_PROMPT = `This PDF is a vendor/clinic contract. Extract ONLY dates — return JSON:
{
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null",
  "renewalDate": "YYYY-MM-DD or null",
  "termMonths": integer or null,
  "noticePeriodDays": integer or null,
  "renewalType": "fixed_term" | "auto_renew" | "month_to_month" | "evergreen" | null
}

Search labels: Effective Date, Commencement Date, Term Begins, Initial Term, Expiration, Expires, End Date, Through, Until, Renewal Date, Notice Period, Term Length.
If the document says "12 months" or "one year" from effective date, set termMonths and compute endDate from startDate.
Do not return null for both startDate and endDate if ANY dates appear in the document.`;

export async function callOpenAiExtract(params: {
  apiKey: string;
  model: string;
  fileName: string;
  fileBase64: string;
  prompt: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract structured metadata from vendor PDF documents. Respond with valid JSON only. Dates must be YYYY-MM-DD.",
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
            { type: "text", text: params.prompt },
          ],
        },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    let message = await response.text();
    try {
      const parsed = JSON.parse(message) as { error?: { message?: string } };
      message = parsed.error?.message ?? message;
    } catch {
      // keep raw
    }
    throw new Error(`OpenAI error (${response.status}): ${message}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response.");

  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("OpenAI returned invalid JSON.");
  }
}

export async function extractContractFromPdf(params: {
  apiKey: string;
  fileName: string;
  fileBase64: string;
}): Promise<ExtractedContract> {
  const model = Deno.env.get("OPENAI_EXTRACT_MODEL")?.trim() || "gpt-4o";

  const primaryRaw = await callOpenAiExtract({
    ...params,
    model,
    prompt: FULL_EXTRACTION_PROMPT,
  });
  let extracted = normalizeExtracted(primaryRaw);

  if (needsDateSecondPass(extracted)) {
    try {
      const dateRaw = await callOpenAiExtract({
        ...params,
        model: "gpt-4o-mini",
        prompt: DATE_FOCUS_PROMPT,
      });
      const dateOnly = normalizeExtracted(dateRaw);
      extracted = enrichExtracted({
        ...extracted,
        startDate: extracted.startDate ?? dateOnly.startDate,
        endDate: extracted.endDate ?? dateOnly.endDate,
        renewalDate: extracted.renewalDate ?? dateOnly.renewalDate,
        termMonths: extracted.termMonths ?? dateOnly.termMonths,
        noticePeriodDays: extracted.noticePeriodDays ?? dateOnly.noticePeriodDays,
        renewalType: extracted.renewalType ?? dateOnly.renewalType,
        extractHints: [
          ...extracted.extractHints,
          ...(dateOnly.startDate || dateOnly.endDate ? ["Dates refined with a second document pass."] : []),
        ],
      });
    } catch {
      // Second pass is best-effort; keep primary result.
    }
  }

  return extracted;
}
