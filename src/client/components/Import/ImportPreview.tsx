/**
 * src/client/components/Import/ImportPreview.tsx
 *
 * ===== FILE PURPOSE =====
 * Modal dialog that drives the CSV / JSON → database table import workflow.
 * Opened when the user drops a .csv/.json file onto a table row in the schema
 * sidebar, or picks one via the "Import CSV/JSON" context-menu item.
 * Only visible in --write or --full mode (SchemaTree guards the entry points).
 *
 * ===== RESPONSIBILITIES OF THIS FILE =====
 * Orchestration only — state management, effects, the POST /api/import call,
 * and the dialog scaffold (backdrop + header + footer). The heavier sub-pieces
 * live in dedicated modules:
 *
 *   parseFile.ts      — CSV / JSON → { columns, rows[] } (no React)
 *   MappingRow.tsx    — one row in the column-mapping grid
 *   importIcons.tsx   — CheckCircleIcon, Spinner
 *
 * ===== FEATURE FLOW =====
 *
 *   1. Mount → parseFile(file) fires immediately.
 *   2. On parse success: set sourceColumns, allRows, auto-map by name match.
 *   3. Mapping panel: source columns (left) → target <select> (right).
 *      Auto-mapped if name matches (case-insensitive). Manual override available.
 *   4. Preview table: first 5 rows projected through the current mapping.
 *   5. Import button: POST /api/import { table, columns, rows }.
 *      Server batches at 100 rows/INSERT inside a single transaction.
 *   6. Footer shows live status: "Importing N rows…" → "✓ Imported N rows in Xms"
 *      or a red error with a Retry button.
 *
 * ===== STATE MACHINE =====
 *
 *   parseStatus:  'parsing' → 'ready' | 'error'
 *   importStatus: 'idle' → 'importing' → 'done' | 'error'
 *
 * ===== ESCAPE / SCROLL LOCK =====
 * Follows the same pattern as DdlViewer:
 *   - body.style.overflow = 'hidden' while open.
 *   - Escape key closes (blocked while importing to avoid mid-transaction close).
 *   - Backdrop click closes (blocked while importing for the same reason).
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import type { ColumnInfo } from "../../hooks/useSchema";
import { ImportIcon } from "../Schema/tree/icons";
import { parseFile } from "./parseFile";
import { MappingRow } from "./MappingRow";
import { CheckCircleIcon, Spinner } from "./importIcons";

// ===== TYPES =====

/**
 * One confirmed mapping from a source column (by position) to a target column
 * (by name). Only non-skipped pairs are included in `mappedPairs`.
 */
interface MappedPair {
  sourceIdx: number;
  target: string;
}

/** Import operation status, distinct from parse status to allow retry. */
type ImportStatus = "idle" | "importing" | "done" | "error";

/** Props accepted by ImportPreview. */
export interface ImportPreviewProps {
  /** Target database table name. */
  table: string;
  /** The file the user dropped or selected (.csv or .json). */
  file: File;
  /**
   * Column metadata for the target table.
   * Used to populate the right-side dropdowns in the mapping panel.
   */
  tableColumns: ColumnInfo[];
  /**
   * Called when the user closes the dialog via ✕, Cancel, Close, Escape,
   * or backdrop click. Disabled (ignored) while an import is in flight.
   */
  onClose: () => void;
}

// ===== COMPONENT =====

/**
 * ImportPreview — CSV/JSON import dialog.
 *
 * Parses the file on mount, shows the column-mapping UI, and sends
 * POST /api/import when the user confirms.
 */
export function ImportPreview({
  table,
  file,
  tableColumns,
  onClose,
}: ImportPreviewProps) {
  // ── Parse phase ──────────────────────────────────────────────────────────
  const [parseStatus, setParseStatus] = useState<"parsing" | "ready" | "error">("parsing");
  const [parseError, setParseError] = useState<string | null>(null);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<unknown[][]>([]);

  // ── Column mapping ────────────────────────────────────────────────────────
  // Parallel array to sourceColumns: mapping[i] is the target column name for
  // sourceColumns[i], or "" to skip. Populated after parse completes.
  const [mapping, setMapping] = useState<string[]>([]);

  // ── Import phase ──────────────────────────────────────────────────────────
  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    rowsImported: number;
    executionTime: number;
  } | null>(null);

  // ── Parse on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    parseFile(file)
      .then(({ columns, rows }) => {
        setSourceColumns(columns);
        setAllRows(rows);
        // Auto-map: case-insensitive name match → pre-select; no match → "".
        setMapping(
          columns.map((srcCol) => {
            const match = tableColumns.find(
              (tc) => tc.name.toLowerCase() === srcCol.toLowerCase()
            );
            return match ? match.name : "";
          })
        );
        setParseStatus("ready");
      })
      .catch((err: unknown) => {
        setParseError(err instanceof Error ? err.message : String(err));
        setParseStatus("error");
      });
    // Fire once on mount — the file and tableColumns props never change
    // during the lifetime of this modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Escape key + body-scroll lock ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && importStatus !== "importing") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, importStatus]);

  // ── Derived: mapped pairs (non-skipped columns) ───────────────────────────
  // Memoised — used by the import handler and the preview table.
  const mappedPairs = useMemo<MappedPair[]>(
    () =>
      mapping
        .map((target, sourceIdx) => ({ sourceIdx, target }))
        .filter((p) => p.target !== ""),
    [mapping]
  );

  // ── Derived: preview rows ─────────────────────────────────────────────────
  // First 5 source rows projected through the current mapping. Updates live as
  // the user changes dropdowns so they see exactly what will be inserted.
  const previewRows = useMemo<unknown[][]>(() => {
    if (parseStatus !== "ready" || mappedPairs.length === 0) return [];
    return allRows
      .slice(0, 5)
      .map((row) =>
        mappedPairs.map(({ sourceIdx }) => (row as unknown[])[sourceIdx])
      );
  }, [allRows, mappedPairs, parseStatus]);

  // ── Mapping change handler ────────────────────────────────────────────────
  const handleMappingChange = useCallback(
    (sourceIdx: number, targetCol: string) => {
      setMapping((prev) => {
        const next = [...prev];
        next[sourceIdx] = targetCol;
        return next;
      });
    },
    []
  );

  // ── Import handler ────────────────────────────────────────────────────────
  //
  // Sends all mapped rows to POST /api/import. The server batches them at
  // 100 rows/INSERT inside a single transaction (rollback on any error).
  const handleImport = useCallback(async () => {
    if (mappedPairs.length === 0 || importStatus !== "idle") return;

    setImportStatus("importing");
    setImportError(null);

    const columns = mappedPairs.map((p) => p.target);
    const rows = allRows.map((row) =>
      mappedPairs.map(({ sourceIdx }) => (row as unknown[])[sourceIdx])
    );

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, columns, rows }),
      });

      const body = (await res.json()) as {
        rowsImported?: number;
        executionTime?: number;
        error?: string;
      };

      if (!res.ok) {
        setImportError(body.error ?? `HTTP ${res.status}`);
        setImportStatus("error");
        return;
      }

      setImportResult({
        rowsImported: body.rowsImported ?? rows.length,
        executionTime: body.executionTime ?? 0,
      });
      setImportStatus("done");
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Network error — import failed."
      );
      setImportStatus("error");
    }
  }, [mappedPairs, importStatus, allRows, table]);

  // ── Backdrop click ────────────────────────────────────────────────────────
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && importStatus !== "importing") {
        onClose();
      }
    },
    [importStatus, onClose]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Import file into ${table}`}
        className="flex flex-col w-[min(720px,92vw)] h-[min(580px,88vh)] rounded-md border border-[#1f2033] bg-[#0a0a0f] shadow-2xl overflow-hidden"
      >
        {/* ===== HEADER ===== */}
        <div className="flex items-center gap-2 px-3 h-9 border-b border-[#1f2033] shrink-0">
          {importStatus === "done" ? <CheckCircleIcon /> : <ImportIcon />}
          <span className="text-[11px] uppercase tracking-widest font-semibold text-[#9ca3af]">
            Import
          </span>
          <span className="text-[#374151]">·</span>
          <span className="text-[12px] font-mono text-[#ededf0] truncate max-w-[160px]">
            {table}
          </span>
          <span className="text-[#374151] text-[10px] font-mono truncate hidden sm:block">
            {file.name}
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={importStatus === "importing"}
            className="flex items-center justify-center w-6 h-6 rounded text-[#4b5563] hover:text-[#ededf0] hover:bg-[#14142b] disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
            aria-label="Close import dialog"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* ===== BODY ===== */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

          {/* ── PARSING ──────────────────────────────────────────────────── */}
          {parseStatus === "parsing" && (
            <div className="flex-1 flex items-center justify-center gap-2 text-[12px] font-mono text-[#374151] italic">
              Parsing{" "}
              <span className="font-semibold text-[#9ca3af]">{file.name}</span>
              <Spinner />
            </div>
          )}

          {/* ── PARSE ERROR ───────────────────────────────────────────────── */}
          {parseStatus === "error" && (
            <div className="flex-1 flex items-start justify-center p-4">
              <div className="w-full p-3 rounded border border-[#3d1f1f] bg-[#130a0a] text-[#f87171] text-[11px] font-mono break-words">
                {parseError}
              </div>
            </div>
          )}

          {/* ── READY: mapping + preview ──────────────────────────────────── */}
          {parseStatus === "ready" && (
            <>
              {/* ── COLUMN MAPPING ───────────────────────────────────────── */}
              <div className="shrink-0 border-b border-[#1f2033]">
                {/* Section header */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-[#4b5563]">
                    Column Mapping
                  </span>
                  <span className="text-[9px] font-mono text-[#374151]">
                    {allRows.length.toLocaleString()}{" "}
                    {allRows.length === 1 ? "row" : "rows"} in file
                  </span>
                </div>

                {/* Column-grid header row */}
                <div className="flex items-center gap-2 px-4 pb-1 border-b border-[#1f2033]/50">
                  <span className="flex-1 min-w-0 text-[9px] uppercase tracking-wider text-[#374151]">
                    File column
                  </span>
                  <span className="shrink-0 w-4" />
                  <span className="w-[160px] shrink-0 text-[9px] uppercase tracking-wider text-[#374151]">
                    {table} column
                  </span>
                </div>

                {/* Scrollable mapping rows */}
                <div className="overflow-y-auto max-h-[180px] px-4 py-2">
                  {sourceColumns.map((srcCol, i) => (
                    <MappingRow
                      key={`${srcCol}-${i}`}
                      sourceCol={srcCol}
                      value={mapping[i] ?? ""}
                      tableColumns={tableColumns}
                      onChange={(v) => handleMappingChange(i, v)}
                    />
                  ))}
                </div>
              </div>

              {/* ── PREVIEW TABLE ─────────────────────────────────────────── */}
              {mappedPairs.length > 0 && previewRows.length > 0 ? (
                <div className="flex flex-col flex-1 min-h-0 px-4 pt-3 pb-2 overflow-hidden">
                  <span className="shrink-0 text-[9px] font-semibold uppercase tracking-widest text-[#4b5563] mb-2">
                    Preview — first {previewRows.length}{" "}
                    {previewRows.length === 1 ? "row" : "rows"}
                  </span>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <table className="border-collapse text-[11px] font-mono w-max min-w-full">
                      <thead>
                        <tr>
                          {mappedPairs.map(({ target }) => (
                            <th
                              key={target}
                              className="px-3 py-1 text-left text-[9px] uppercase tracking-wider font-semibold text-[#4b5563] border-b border-[#1f2033] whitespace-nowrap"
                            >
                              {target}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, ri) => (
                          <tr
                            key={ri}
                            className="border-b border-[#1f2033]/40 hover:bg-[#0d0d17]"
                          >
                            {row.map((cell, ci) => (
                              <td
                                key={ci}
                                className="px-3 py-1 text-[#9ca3af] max-w-[200px] truncate"
                                title={cell != null ? String(cell) : "null"}
                              >
                                {cell == null ? (
                                  <span className="text-[#374151] italic">
                                    null
                                  </span>
                                ) : (
                                  String(cell)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : mappedPairs.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-[11px] italic text-[#2d3047] font-mono">
                  Map at least one column to see a preview.
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* ===== FOOTER ===== */}
        <div className="flex items-center justify-between gap-3 px-4 h-11 border-t border-[#1f2033] shrink-0">

          {/* ── Status text ───────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 text-[11px] font-mono truncate">
            {importStatus === "importing" && (
              <span className="flex items-center gap-2 text-[#9ca3af]">
                Importing {allRows.length.toLocaleString()} rows
                <Spinner />
              </span>
            )}
            {importStatus === "done" && importResult && (
              <span className="text-[#34d399]">
                ✓ Imported {importResult.rowsImported.toLocaleString()} rows in{" "}
                {importResult.executionTime < 1
                  ? "<1"
                  : Math.round(importResult.executionTime).toLocaleString()}
                ms
              </span>
            )}
            {importStatus === "error" && importError && (
              <span className="text-[#f87171]" title={importError}>
                {importError}
              </span>
            )}
            {importStatus === "idle" && parseStatus === "ready" && (
              <span className="text-[#4b5563]">
                {mappedPairs.length} of {sourceColumns.length}{" "}
                {sourceColumns.length === 1 ? "column" : "columns"} mapped
                {mappedPairs.length === 0 && (
                  <span className="text-[#ef4444]">
                    {" "}— select at least one target column
                  </span>
                )}
              </span>
            )}
          </div>

          {/* ── Action buttons ────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 shrink-0">
            {importStatus === "done" ? (
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-[#14142b] hover:bg-[#1c1c38] text-[#9ca3af] border border-[#2d2d3d] transition-colors duration-100 select-none"
              >
                Close
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  disabled={importStatus === "importing"}
                  className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-[#14142b] hover:bg-[#1c1c38] text-[#9ca3af] border border-[#2d2d3d] disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100 select-none"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={
                    parseStatus !== "ready" ||
                    mappedPairs.length === 0 ||
                    importStatus === "importing"
                  }
                  className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-blue-900/40 hover:bg-blue-800/50 text-blue-400 border border-blue-700/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100 select-none"
                >
                  {importStatus === "importing" ? (
                    <>Importing <Spinner /></>
                  ) : importStatus === "error" ? (
                    "Retry"
                  ) : (
                    <>
                      Import{" "}
                      {allRows.length > 0 && (
                        <span className="text-blue-500/80">
                          {allRows.length.toLocaleString()}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
