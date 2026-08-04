import { CONTRACT_END_LABEL } from "./renewals";

export const MAX_VENDOR_IMPORT_ROWS = 500;

export type VendorImportRow = {
  name: string;
  category: string;
  address?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contractName?: string;
  contractEndDate?: string;
  contractValue?: number;
};

/** @deprecated use VendorImportRow */
export type CsvVendorRow = VendorImportRow;

export type VendorImportField =
  | "name"
  | "category"
  | "address"
  | "contact_name"
  | "contact_email"
  | "contact_phone"
  | "contract_name"
  | "contract_end_date"
  | "contract_value";

export const VENDOR_IMPORT_FIELDS: {
  key: VendorImportField;
  label: string;
  required?: boolean;
}[] = [
  { key: "name", label: "Vendor name", required: true },
  { key: "category", label: "Category / type", required: true },
  { key: "address", label: "Street address" },
  { key: "contact_name", label: "Contact name" },
  { key: "contact_email", label: "Contact email" },
  { key: "contact_phone", label: "Contact phone" },
  { key: "contract_name", label: "Contract name" },
  { key: "contract_end_date", label: CONTRACT_END_LABEL },
  { key: "contract_value", label: "Contract value" },
];

export type SpreadsheetTable = {
  headers: string[];
  rows: string[][];
  sheetName: string;
};

export type ColumnMapping = Partial<Record<VendorImportField, number>>;

const HEADER_ALIASES: Record<VendorImportField, string[]> = {
  name: ["name", "vendor", "vendor_name", "company", "supplier", "supplier_name", "business"],
  category: ["category", "type", "vendor_type", "service", "service_type", "department"],
  address: [
    "address",
    "street",
    "street_address",
    "mailing_address",
    "location",
    "vendor_address",
    "physical_address",
    "office_address",
  ],
  contact_name: ["contact_name", "contact", "primary_contact", "rep", "representative", "account_manager"],
  contact_email: ["contact_email", "email", "e_mail", "contact_mail"],
  contact_phone: ["contact_phone", "phone", "telephone", "tel", "mobile", "cell"],
  contract_name: ["contract_name", "contract", "agreement", "service_agreement", "contract_title"],
  contract_end_date: [
    "contract_end_date",
    "end_date",
    "renewal_date",
    "renewal",
    "expires",
    "expiration",
    "contract_end",
    "term_end",
  ],
  contract_value: ["contract_value", "value", "amount", "annual_value", "contract_amount", "spend"],
};

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "_");
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

export function parseMoney(value: string) {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
}

export function parseImportDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Excel serial number passed as string
  if (/^\d{5}(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + serial * 86400000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }

  const usMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (usMatch) {
    const month = usMatch[1].padStart(2, "0");
    const day = usMatch[2].padStart(2, "0");
    let year = usMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function tableFromCsvText(text: string): SpreadsheetTable {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { headers: [], rows: [], sheetName: "CSV" };
  }

  const headers = parseCsvLine(lines[0]).map(cellToString);
  const rows = lines.slice(1).map((line) => parseCsvLine(line).map(cellToString));
  return { headers, rows, sheetName: "CSV" };
}

async function loadXlsx() {
  return import("@e965/xlsx");
}

export async function tableFromExcelBuffer(buffer: ArrayBuffer, sheetIndex = 0): Promise<SpreadsheetTable> {
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[sheetIndex] ?? workbook.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [], sheetName: "Sheet1" };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });

  const normalized = matrix
    .map((row) => (Array.isArray(row) ? row.map(cellToString) : [cellToString(row)]))
    .filter((row) => row.some((cell) => cell.trim() !== ""));

  if (normalized.length === 0) {
    return { headers: [], rows: [], sheetName };
  }

  const headerRowIndex = detectHeaderRowIndex(normalized);
  return tableWithHeaderRow(
    { headers: normalized[0], rows: normalized.slice(1), sheetName },
    headerRowIndex
  );
}

export function detectHeaderRowIndex(matrix: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(matrix.length, 8); i += 1) {
    const row = matrix[i];
    const normalized = row.map(normalizeHeader);
    let score = 0;
    for (const field of VENDOR_IMPORT_FIELDS) {
      if (normalized.some((header) => HEADER_ALIASES[field.key].includes(header))) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export function tableWithHeaderRow(table: SpreadsheetTable, headerRowIndex: number): SpreadsheetTable {
  const matrix = [table.headers, ...table.rows];
  const headerRow = matrix[headerRowIndex] ?? [];
  const dataRows = matrix.slice(headerRowIndex + 1);
  return {
    headers: headerRow.map(cellToString),
    rows: dataRows.map((row) => row.map(cellToString)),
    sheetName: table.sheetName,
  };
}

export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();

  for (const field of VENDOR_IMPORT_FIELDS) {
    const index = normalized.findIndex(
      (header, idx) => !used.has(idx) && HEADER_ALIASES[field.key].includes(header)
    );
    if (index >= 0) {
      mapping[field.key] = index;
      used.add(index);
    }
  }

  return mapping;
}

export function mappingIsValid(mapping: ColumnMapping) {
  return mapping.name !== undefined && mapping.category !== undefined;
}

export function rowsFromMappedTable(
  table: SpreadsheetTable,
  mapping: ColumnMapping
): { rows: VendorImportRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: VendorImportRow[] = [];

  if (!mappingIsValid(mapping)) {
    return { rows: [], errors: ["Map vendor name and category columns before importing."] };
  }

  if (table.rows.length > MAX_VENDOR_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [`Import is limited to ${MAX_VENDOR_IMPORT_ROWS} vendors per file.`],
    };
  }

  const get = (row: string[], field: VendorImportField) => {
    const index = mapping[field];
    if (index === undefined) return "";
    return row[index]?.trim() ?? "";
  };

  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const cells = table.rows[rowIndex];
    const lineNumber = rowIndex + 2;

    const name = get(cells, "name");
    const category = get(cells, "category");

    if (!name && !category) continue;
    if (!name) {
      errors.push(`Row ${lineNumber}: vendor name is required.`);
      continue;
    }
    if (!category) {
      errors.push(`Row ${lineNumber}: category is required for "${name}".`);
      continue;
    }

    const contractValueRaw = get(cells, "contract_value");
    const contractValue = contractValueRaw ? parseMoney(contractValueRaw) : undefined;
    if (contractValueRaw && contractValue === undefined) {
      errors.push(`Row ${lineNumber}: invalid contract value "${contractValueRaw}".`);
    }

    const contractEndDateRaw = get(cells, "contract_end_date");
    const contractEndDate = contractEndDateRaw ? parseImportDate(contractEndDateRaw) : undefined;
    if (contractEndDateRaw && !contractEndDate) {
      errors.push(`Row ${lineNumber}: invalid contract end date "${contractEndDateRaw}".`);
    }

    rows.push({
      name,
      category,
      address: get(cells, "address") || undefined,
      contactName: get(cells, "contact_name") || undefined,
      contactEmail: get(cells, "contact_email") || undefined,
      contactPhone: get(cells, "contact_phone") || undefined,
      contractName: get(cells, "contract_name") || undefined,
      contractEndDate,
      contractValue,
    });
  }

  return { rows, errors };
}

export function summarizeImportRows(rows: VendorImportRow[]) {
  const missingRenewalDates = rows.filter((row) => !row.contractEndDate).length;
  const missingContacts = rows.filter((row) => !row.contactEmail && !row.contactPhone).length;
  const withContracts = rows.filter((row) => row.contractName || row.contractEndDate).length;
  return { missingRenewalDates, missingContacts, withContracts };
}

export function vendorImportTemplateCsv() {
  return [
    "name,category,address,contact_name,contact_email,contact_phone,contract_name,contract_end_date,contract_value",
    "Brightline Services,Maintenance,1200 Market St Suite 400 San Francisco CA 94103,Jane Doe,jane@brightline.com,555-0100,HVAC Agreement,2026-07-11,18500",
    "LabCore Diagnostics,Lab,,,,Annual service agreement,2026-12-01,42000",
  ].join("\n");
}

/** @deprecated use rowsFromMappedTable after tableFromCsvText */
export function parseVendorCsv(text: string): { rows: VendorImportRow[]; errors: string[] } {
  const table = tableFromCsvText(text);
  const mapping = suggestColumnMapping(table.headers);
  if (!mapping.name || !mapping.category) {
    const normalized = table.headers.map(normalizeHeader);
    if (normalized.includes("name") && normalized.includes("category")) {
      return rowsFromMappedTable(table, {
        name: normalized.indexOf("name"),
        category: normalized.indexOf("category"),
        address: normalized.indexOf("address"),
        contact_name: normalized.indexOf("contact_name"),
        contact_email: normalized.indexOf("contact_email"),
        contact_phone: normalized.indexOf("contact_phone"),
        contract_name: normalized.indexOf("contract_name"),
        contract_end_date: normalized.indexOf("contract_end_date"),
        contract_value: normalized.indexOf("contract_value"),
      });
    }
  }
  return rowsFromMappedTable(table, mapping);
}

export async function parseVendorSpreadsheetFile(file: File): Promise<SpreadsheetTable> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "csv" || file.type.includes("csv")) {
    const text = await file.text();
    return tableFromCsvText(text);
  }

  if (extension === "xlsx" || extension === "xls" || file.type.includes("sheet") || file.type.includes("excel")) {
    const buffer = await file.arrayBuffer();
    return tableFromExcelBuffer(buffer);
  }

  throw new Error("Unsupported file type. Upload .xlsx, .xls, or .csv.");
}

export async function excelWorkbookSheetNames(buffer: ArrayBuffer): Promise<string[]> {
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  return workbook.SheetNames;
}

export async function tableFromExcelBufferSheet(buffer: ArrayBuffer, sheetName: string): Promise<SpreadsheetTable> {
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { headers: [], rows: [], sheetName };
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const normalized = matrix
    .map((row) => (Array.isArray(row) ? row.map(cellToString) : [cellToString(row)]))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  if (normalized.length === 0) return { headers: [], rows: [], sheetName };
  const headerRowIndex = detectHeaderRowIndex(normalized);
  return tableWithHeaderRow(
    { headers: normalized[0], rows: normalized.slice(1), sheetName },
    headerRowIndex
  );
}