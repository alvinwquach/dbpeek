/**
 * src/client/hooks/useSchema.ts
 *
 * WHAT:
 *   React hook that fetches GET /api/schema on mount, then fetches each table's
 *   columns via GET /api/schema/:table, and stores the combined result in the
 *   Zustand store.  This cached data powers two features:
 *     1. The CodeMirror schema-aware autocomplete (Phase 2, this PR).
 *     2. The database sidebar tree view (Phase 3).
 *
 * WHY a custom hook instead of TanStack Query:
 *   Same reasoning as useQuery.ts — the app avoids TanStack Query's 5 KB
 *   overhead for cases that need only a one-shot fetch with local state.
 *   Schema is fetched once on mount and never auto-refetched; a manual
 *   `refresh()` handle is exposed for the sidebar's refresh button.
 *
 * HOW — fetch strategy:
 *   1. GET /api/schema          → list of table names
 *   2. Promise.all(tables.map(t → GET /api/schema/:table))
 *                               → column lists, fetched in parallel
 *   3. Build a SchemaMap        → { tableName: string[] } (column name arrays)
 *      and a SchemaColumns map  → { tableName: ColumnInfo[] } (rich metadata)
 *   4. Write both into Zustand via setSchema(…)
 *
 * WHY columns are also stored as rich ColumnInfo objects (not just names):
 *   The autocomplete only needs names, but Phase 3's sidebar will want types,
 *   nullability, PK/FK/index flags.  Fetching once and caching the full shape
 *   avoids a second round-trip when the sidebar mounts.
 *
 * WHY parallel column fetches (Promise.all):
 *   Sequential fetches for a schema with 50 tables would take 50× the round-
 *   trip time.  Promise.all fires them all at once; most databases return
 *   INFORMATION_SCHEMA queries in < 5 ms, so the entire schema loads in one
 *   round-trip worth of latency regardless of table count.
 */

import { useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../stores/app";

// ===== TYPES =====

/**
 * Rich column metadata returned by GET /api/schema/:table.
 * Mirrors the server's ColumnInfo shape defined in src/server/routes/schema.ts.
 */
export interface ColumnInfo {
  /** Column name as it appears in the database. */
  name: string;
  /** Database type string, e.g. "varchar(255)", "integer", "text". */
  type: string;
  /** True if the column accepts NULL values. */
  nullable: boolean;
  /** Server-side default expression, or null if none. */
  defaultValue: string | null;
  /** True if this column is (part of) the primary key. */
  isPrimaryKey: boolean;
  /**
   * Foreign key target in "table.column" form, or null if not a FK.
   * Example: "users.id"
   */
  foreignKey: string | null;
  /** True if this column has a standalone index (not just PK/FK). */
  isIndexed: boolean;
}

/**
 * The raw JSON body returned by GET /api/schema.
 * `rowCount` is an estimate — do not rely on it for exact counts.
 */
interface SchemaListResponse {
  tables: Array<{ name: string; rowCount: number }>;
}

/** The raw JSON body returned by GET /api/schema/:table. */
interface SchemaTableResponse {
  columns: ColumnInfo[];
}

/**
 * A table-name → column-name-array map.
 * This is the shape consumed by @codemirror/lang-sql's `schema` option:
 *   { users: ["id", "email", "name"], orders: ["id", "user_id", "total"] }
 */
export type SchemaMap = Record<string, string[]>;

/**
 * A table-name → ColumnInfo-array map.
 * Cached for the sidebar (Phase 3) so column types/flags are available
 * without a second fetch.
 */
export type SchemaColumns = Record<string, ColumnInfo[]>;

// ===== HOOK =====

/**
 * useSchema — fetches and caches the connected database's schema.
 *
 * Designed to be called once, near the top of the component tree (App.tsx).
 * Stores results in Zustand so both the editor and sidebar can subscribe
 * without prop drilling.
 *
 * @returns
 *   loading  — true while the initial fetch is in-flight.
 *   error    — error message if the fetch failed, null otherwise.
 *   refresh  — imperative handle to re-fetch the schema (e.g. after a CREATE TABLE).
 */
export function useSchema(): {
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  // ── Zustand: read loading/error state; write via setSchema ────────────────
  const loading = useAppStore((s) => s.schemaLoading);
  const error = useAppStore((s) => s.schemaError);
  const setSchema = useAppStore((s) => s.setSchema);
  const setSchemaLoading = useAppStore((s) => s.setSchemaLoading);
  const setSchemaError = useAppStore((s) => s.setSchemaError);

  // ── Stable fetchSchema function ───────────────────────────────────────────
  // useCallback so that the useEffect dep array can safely include it without
  // causing an infinite loop.  The actions from Zustand are stable references.
  const fetchSchema = useCallback(async () => {
    setSchemaLoading(true);
    setSchemaError(null);

    try {
      // Step 1: get the table list.
      const listRes = await fetch("/api/schema");
      if (!listRes.ok) {
        throw new Error(`Failed to load schema: HTTP ${listRes.status}`);
      }
      const listData = (await listRes.json()) as SchemaListResponse;
      const tableNames = listData.tables.map((t) => t.name);

      // Step 2: fetch all column lists in parallel.
      // The server whitelists the table name before querying, so URL-encoding
      // is the only escaping we need on the client side.
      const columnResponses = await Promise.all(
        tableNames.map(async (table) => {
          const res = await fetch(
            `/api/schema/${encodeURIComponent(table)}`
          );
          if (!res.ok) {
            // A missing table is not fatal — skip it so one bad table doesn't
            // block autocomplete for all the others.
            return { table, columns: [] as ColumnInfo[] };
          }
          const data = (await res.json()) as SchemaTableResponse;
          return { table, columns: data.columns };
        })
      );

      // Step 3: build the two maps.
      // schemaMap   → { tableName: string[] }   (for CodeMirror)
      // schemaColumns → { tableName: ColumnInfo[] } (for the sidebar)
      const schemaMap: SchemaMap = {};
      const schemaColumns: SchemaColumns = {};

      for (const { table, columns } of columnResponses) {
        schemaMap[table] = columns.map((c) => c.name);
        schemaColumns[table] = columns;
      }

      // Step 4: write into Zustand.  This triggers the SqlEditor to
      // reconfigure its autocomplete extension with the live schema.
      setSchema(schemaMap, schemaColumns);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to load schema — is the server running?";
      setSchemaError(msg);
    } finally {
      setSchemaLoading(false);
    }
  }, [setSchema, setSchemaLoading, setSchemaError]);

  // ── Mount effect: fetch once ──────────────────────────────────────────────
  // Use a ref to guard against double-invocation in React Strict Mode.
  // Without this guard, Strict Mode's double-effect would fire two parallel
  // fetches, and the second one could overwrite the first mid-flight.
  const hasFetched = useRef(false);
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchSchema();
  }, [fetchSchema]);

  return { loading, error, refresh: fetchSchema };
}
