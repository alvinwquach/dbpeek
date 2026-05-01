/**
 * chart/chartDetect.ts — column-type detection and Recharts data transformation.
 *
 * WHAT:
 *   Pure functions that inspect a QueryResult, classify each column as "date",
 *   "numeric", or "text", then choose the correct chart type and build the flat
 *   object array Recharts expects. No React, no side effects.
 *
 * WHY isolated here:
 *   Detection logic is testable in isolation and has no dependency on React or
 *   the DOM. Keeping it in a plain .ts module makes it importable from tests
 *   without mounting a component tree.
 *
 * DETECTION PRIORITY (per spec):
 *   1. date column + numeric column → LINE CHART  (date x-axis)
 *   2. text column + numeric column → BAR CHART   (text x-axis)
 *   3. neither found               → null         → "No chartable columns detected"
 */

import type { QueryResult } from "../../../types";

// ===== CONSTANTS =====

/** Rows sampled when classifying columns. 50 is enough to catch mixed types. */
export const MAX_SAMPLE_ROWS = 50;

/** Max data points passed to Recharts. Prevents SVG from stalling on large results. */
export const MAX_CHART_ROWS = 500;

/** Series accent colours matched to the app palette. */
export const SERIES_COLORS = [
  "#7c85d6",
  "#34d399",
  "#f59e0b",
  "#f87171",
  "#a78bfa",
  "#38bdf8",
];

/** Max chars before a categorical x-axis label is truncated with "…". */
const MAX_LABEL_CHARS = 16;

// ===== TYPES =====

/** Heuristic kind assigned to each column. */
export type ColKind = "date" | "numeric" | "text";

/**
 * ChartConfig — full specification for rendering, produced by detectChartConfig().
 * Both BarChartView and LineChartView accept this shape so neither re-derives roles.
 */
export interface ChartConfig {
  /** "bar" for categorical x-axis, "line" for temporal x-axis. */
  type: "bar" | "line";
  /** Index into QueryResult.columns used as x-axis labels. */
  xIndex: number;
  /** Indices of numeric columns plotted as series (one series per index). */
  yIndices: number[];
  /** Pre-built Recharts data array: [{ __x: label, colName: value, ... }] */
  data: Record<string, string | number | null>[];
}

// ===== LABEL FORMATTERS =====

/**
 * formatXLabel — clips categorical labels to MAX_LABEL_CHARS with a trailing "…".
 * Keeps x-axis ticks legible on narrow panels.
 */
export function formatXLabel(value: unknown): string {
  const s = value == null ? "" : String(value);
  return s.length > MAX_LABEL_CHARS ? s.slice(0, MAX_LABEL_CHARS) + "…" : s;
}

/**
 * formatDateLabel — converts date-like values to compact ISO strings.
 *
 * WHY not Intl.DateTimeFormat:
 *   Locale-formatted strings ("Apr 30, 2026") are too wide for axis ticks.
 *   ISO date (YYYY-MM-DD) or ISO datetime (YYYY-MM-DD HH:MM) is compact,
 *   unambiguous, and naturally sortable.
 */
export function formatDateLabel(value: unknown): string {
  if (value == null) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  const iso = d.toISOString();
  // Midnight UTC → date-only value; omit the time component.
  return iso.endsWith("T00:00:00.000Z")
    ? iso.slice(0, 10)
    : iso.slice(0, 16).replace("T", " ");
}

// ===== COLUMN CLASSIFICATION =====

/**
 * classifyColumn — assigns a ColKind to a column using name heuristics first,
 * then value sampling.
 *
 * Detection order:
 *   1. Name contains a date keyword → "date"
 *   2. All sampled non-null values parse as valid Dates → "date"
 *   3. All sampled non-null values coerce to a finite number (excluding booleans) → "numeric"
 *   4. Fallback → "text"
 *
 * WHY name-first:
 *   Drivers return dates as JS Date objects or ISO strings. Column names like
 *   "created_at" are reliable signals that don't require inspecting every row.
 */
export function classifyColumn(name: string, samples: unknown[]): ColKind {
  const lower = name.toLowerCase();

  const dateKeywords = [
    "date",
    "time",
    "created",
    "updated",
    "timestamp",
    "_at",
  ];
  if (dateKeywords.some((kw) => lower.includes(kw))) return "date";

  const nonNull = samples.filter((v) => v != null && v !== "");

  if (nonNull.length > 0) {
    const allDates = nonNull.every((v) => {
      if (v instanceof Date) return !isNaN(v.getTime());
      if (typeof v === "string") {
        const d = new Date(v);
        return !isNaN(d.getTime()) && v.length >= 8;
      }
      return false;
    });
    if (allDates) return "date";
  }

  if (nonNull.length > 0) {
    const allNumeric = nonNull.every(
      (v) => typeof v !== "boolean" && isFinite(Number(v))
    );
    if (allNumeric) return "numeric";
  }

  return "text";
}

// ===== DATA BUILDER =====

/**
 * buildChartData — transforms QueryResult rows into the flat object array
 * Recharts expects: [{ __x: label, colA: 12, colB: 34 }, ...].
 *
 * Slices to MAX_CHART_ROWS before transforming so the SVG stays responsive.
 * Null / non-finite values are stored as null — Recharts renders those as
 * gaps in line charts rather than bridging them, which is correct for missing data.
 */
export function buildChartData(
  columns: string[],
  rows: unknown[][],
  xIndex: number,
  yIndices: number[],
  xKind: "date" | "text"
): Record<string, string | number | null>[] {
  return rows.slice(0, MAX_CHART_ROWS).map((row) => {
    const xRaw = row[xIndex];
    const xLabel =
      xKind === "date" ? formatDateLabel(xRaw) : formatXLabel(xRaw);

    const point: Record<string, string | number | null> = { __x: xLabel };

    for (const yi of yIndices) {
      const colName = columns[yi] ?? String(yi);
      const raw = row[yi];
      const num = raw == null ? null : Number(raw);
      point[colName] = num != null && isFinite(num) ? num : null;
    }

    return point;
  });
}

// ===== MAIN DETECTOR =====

/**
 * detectChartConfig — entry point for the auto-detection pipeline.
 *
 * Returns a fully populated ChartConfig (ready for BarChartView / LineChartView)
 * or null if no chartable column pair exists in the result.
 *
 * WHY null instead of throw:
 *   ChartView must handle any query result gracefully. Returning null lets the
 *   caller render a "No chartable columns detected" state without try/catch.
 */
export function detectChartConfig(result: QueryResult): ChartConfig | null {
  const { columns, rows } = result;
  const sample = rows.slice(0, MAX_SAMPLE_ROWS);

  const kinds: ColKind[] = columns.map((name: string, ci: number) =>
    classifyColumn(name, sample.map((row: unknown[]) => row[ci]))
  );

  const numericIndices = kinds
    .map((k, i) => (k === "numeric" ? i : -1))
    .filter((i) => i !== -1);

  // Priority 1: date + numeric → LINE CHART
  const dateIdx = kinds.findIndex((k) => k === "date");
  if (dateIdx !== -1 && numericIndices.length > 0) {
    const yIndices = numericIndices.filter((i) => i !== dateIdx);
    if (yIndices.length > 0) {
      return {
        type: "line",
        xIndex: dateIdx,
        yIndices,
        data: buildChartData(columns, rows, dateIdx, yIndices, "date"),
      };
    }
  }

  // Priority 2: text + numeric → BAR CHART
  const textIdx = kinds.findIndex((k) => k === "text");
  if (textIdx !== -1 && numericIndices.length > 0) {
    const yIndices = numericIndices.filter((i) => i !== textIdx);
    if (yIndices.length > 0) {
      return {
        type: "bar",
        xIndex: textIdx,
        yIndices,
        data: buildChartData(columns, rows, textIdx, yIndices, "text"),
      };
    }
  }

  return null;
}
