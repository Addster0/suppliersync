import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { importVendorsFromCsv } from "../api/vendors";
import {
  excelWorkbookSheetNames,
  mappingIsValid,
  parseVendorSpreadsheetFile,
  rowsFromMappedTable,
  suggestColumnMapping,
  tableFromExcelBufferSheet,
  vendorImportTemplateCsv,
  VENDOR_IMPORT_FIELDS,
  type ColumnMapping,
  type SpreadsheetTable,
  type VendorImportRow,
} from "../lib/vendorImport";

type Props = {
  organizationId: string;
  onImported: () => void;
  onClose?: () => void;
  compact?: boolean;
  initialFile?: File | null;
  onInitialFileHandled?: () => void;
};

export function VendorImportPanel({
  organizationId,
  onImported,
  onClose,
  compact = false,
  initialFile = null,
  onInitialFileHandled,
}: Props) {
  const fileInputId = useId();
  const handledInitialFileRef = useRef<File | null>(null);
  const [table, setTable] = useState<SpreadsheetTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<VendorImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [excelBuffer, setExcelBuffer] = useState<ArrayBuffer | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState("");

  const columnOptions = useMemo(() => {
    if (!table) return [];
    return [
      { value: "", label: "— Skip —" },
      ...table.headers.map((header, index) => ({
        value: String(index),
        label: header.trim() || `Column ${index + 1}`,
      })),
    ];
  }, [table]);

  const importStatusHint = useMemo(() => {
    if (importing) return null;
    if (!organizationId) return "Select a workspace before importing.";
    if (!table) return "Upload a spreadsheet to get started.";
    if (!mappingIsValid(mapping)) return "Map vendor name and category columns to continue.";
    if (preview.length === 0) {
      return parseErrors[0] ?? "No valid vendor rows found. Check your column mapping and data.";
    }
    return null;
  }, [importing, organizationId, table, mapping, preview.length, parseErrors]);

  function applyMapping(nextTable: SpreadsheetTable, nextMapping: ColumnMapping) {
    const result = rowsFromMappedTable(nextTable, nextMapping);
    setPreview(result.rows);
    setParseErrors(result.errors);
  }

  function handleMappingChange(field: keyof ColumnMapping, columnIndex: string) {
    const next = { ...mapping };
    if (columnIndex === "") {
      delete next[field];
    } else {
      next[field] = Number(columnIndex);
    }
    setMapping(next);
    if (table) applyMapping(table, next);
  }

  async function loadTableFromFile(file: File) {
    setLoadingFile(true);
    setError("");
    setMessage("");

    try {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      let nextTable: SpreadsheetTable;

      if (extension === "xlsx" || extension === "xls") {
        const buffer = await file.arrayBuffer();
        setExcelBuffer(buffer);
        const names = await excelWorkbookSheetNames(buffer);
        setSheetNames(names);
        const sheet = names[0] ?? "";
        setActiveSheet(sheet);
        nextTable = await tableFromExcelBufferSheet(buffer, sheet);
      } else {
        setExcelBuffer(null);
        setSheetNames([]);
        setActiveSheet("");
        nextTable = await parseVendorSpreadsheetFile(file);
      }

      if (nextTable.headers.length === 0) {
        throw new Error("Could not find column headers in that file.");
      }

      const suggested = suggestColumnMapping(nextTable.headers);
      setTable(nextTable);
      setMapping(suggested);
      applyMapping(nextTable, suggested);
    } catch (err) {
      setTable(null);
      setPreview([]);
      setParseErrors([]);
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setLoadingFile(false);
    }
  }

  useEffect(() => {
    if (!initialFile) {
      handledInitialFileRef.current = null;
      return;
    }
    if (handledInitialFileRef.current === initialFile) return;
    handledInitialFileRef.current = initialFile;
    void loadTableFromFile(initialFile);
    onInitialFileHandled?.();
  }, [initialFile, onInitialFileHandled]);

  async function handleSheetChange(sheetName: string) {
    if (!excelBuffer) return;
    setActiveSheet(sheetName);
    const nextTable = await tableFromExcelBufferSheet(excelBuffer, sheetName);
    const suggested = suggestColumnMapping(nextTable.headers);
    setTable(nextTable);
    setMapping(suggested);
    applyMapping(nextTable, suggested);
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    void loadTableFromFile(file);
  }

  function downloadTemplate() {
    const blob = new Blob([vendorImportTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vendor-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(event: FormEvent) {
    event.preventDefault();

    if (!organizationId) {
      setError("No workspace selected.");
      return;
    }
    if (!mappingIsValid(mapping)) {
      setError("Map vendor name and category columns before importing.");
      return;
    }
    if (preview.length === 0) {
      setError(parseErrors[0] ?? "No vendor rows to import.");
      return;
    }

    setImporting(true);
    setMessage("");
    setError("");

    try {
      const result = await importVendorsFromCsv(organizationId, preview);
      let summary = `Imported ${result.imported} vendor${result.imported === 1 ? "" : "s"}.`;
      if (result.missingRenewalDates > 0) {
        summary += ` ${result.missingRenewalDates} missing renewal dates — add them in Contracts.`;
      }
      if (result.missingContacts > 0) {
        summary += ` ${result.missingContacts} missing contacts.`;
      }
      setMessage(summary);
      onImported();
      if (result.imported > 0) {
        setTable(null);
        setPreview([]);
        setParseErrors([]);
        setMapping({});
        setExcelBuffer(null);
        setSheetNames([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  const missingRenewals = preview.filter((row) => !row.contractEndDate).length;
  const canImport = !importing && preview.length > 0 && mappingIsValid(mapping) && Boolean(organizationId);

  return (
    <section className={`vendor-import${compact ? " vendor-import--compact" : ""}`}>
      <div className="vendor-import-header">
        <div>
          <p className="label">Import from Excel or CSV</p>
          <p className="muted small">
            Upload your vendor spreadsheet — we&apos;ll map columns and create vendors, contacts, and contract
            renewals.
          </p>
        </div>
        {onClose && (
          <button className="ghost" onClick={onClose} type="button">
            Close
          </button>
        )}
      </div>

      <div className="vendor-import-actions">
        <button className="secondary" onClick={downloadTemplate} type="button">
          Download template
        </button>
      </div>

      <div
        className={`drop-zone vendor-import-drop-zone ${isDragging ? "dragging" : ""} ${loadingFile ? "disabled" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!loadingFile) setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!loadingFile) setIsDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!loadingFile) handleFiles(event.dataTransfer.files);
        }}
      >
        <input
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="drop-zone-input"
          disabled={loadingFile}
          id={fileInputId}
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
          type="file"
        />
        <label className="drop-zone-label" htmlFor={fileInputId}>
          <strong>{loadingFile ? "Reading file…" : isDragging ? "Drop to upload" : "Upload Excel or CSV"}</strong>
          <span className="muted">Drag & drop or click to browse · .xlsx, .xls, .csv</span>
        </label>
      </div>

      {sheetNames.length > 1 && (
        <label className="vendor-import-sheet-picker">
          <span className="label">Worksheet</span>
          <select onChange={(event) => void handleSheetChange(event.target.value)} value={activeSheet}>
            {sheetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}

      {table && (
        <div className="vendor-import-mapper card">
          <p className="label">Map your columns</p>
          <p className="muted small">
            Matched from <strong>{table.sheetName}</strong>. Adjust if your headers differ.
          </p>
          <div className="vendor-import-mapper-grid">
            {VENDOR_IMPORT_FIELDS.map((field) => (
              <label key={field.key}>
                <span>
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
                <select
                  onChange={(event) => handleMappingChange(field.key, event.target.value)}
                  value={mapping[field.key] !== undefined ? String(mapping[field.key]) : ""}
                >
                  {columnOptions.map((option) => (
                    <option key={`${field.key}-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {preview.length > 0 && (
        <div className="vendor-import-preview">
          <p className="label">
            Preview — {preview.length} vendor{preview.length === 1 ? "" : "s"} ready
            {missingRenewals > 0 ? ` · ${missingRenewals} without renewal dates` : ""}
          </p>
          <div className="vendor-import-preview-table-wrap">
            <table className="vendor-import-preview-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Category</th>
                  <th>Address</th>
                  <th>Contact</th>
                  <th>Contract end (renewal)</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, compact ? 4 : 8).map((row) => (
                  <tr key={`${row.name}-${row.category}-${row.contractEndDate ?? ""}`}>
                    <td>{row.name}</td>
                    <td>{row.category}</td>
                    <td>{row.address || "—"}</td>
                    <td>{row.contactEmail || row.contactPhone || row.contactName || "—"}</td>
                    <td>{row.contractEndDate || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > (compact ? 4 : 8) && (
            <p className="muted small">…and {preview.length - (compact ? 4 : 8)} more rows</p>
          )}
        </div>
      )}

      {parseErrors.length > 0 && (
        <div className="banner error vendor-import-banner">
          {parseErrors.slice(0, 4).map((item) => (
            <p key={item}>{item}</p>
          ))}
          {parseErrors.length > 4 && <p>…and {parseErrors.length - 4} more row issues.</p>}
        </div>
      )}

      <form onSubmit={(event) => void handleImport(event)}>
        <button disabled={!canImport} type="submit">
          {importing ? "Importing…" : `Import ${preview.length || ""} vendor${preview.length === 1 ? "" : "s"}`}
        </button>
        {importStatusHint && <p className="muted small vendor-import-hint">{importStatusHint}</p>}
      </form>

      {message && <div className="banner success vendor-import-banner">{message}</div>}
      {error && <div className="banner error vendor-import-banner">{error}</div>}
    </section>
  );
}
