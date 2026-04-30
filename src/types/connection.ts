// ===== FILE PURPOSE =====
// Shared connection types consumed by both the CLI parser and the Express server.
// Keeping them here prevents the server layer from importing out of the CLI layer.

// ===== TYPES =====

/**
 * The set of database engines supported by dbpeek / knex.
 *
 * WHY `type` and not `enum`:
 *   TypeScript enums compile to a runtime object (extra JS emitted) and require
 *   an import to use as a value. A string union `type` is erased at compile time —
 *   zero runtime cost — and TypeScript still exhaustiveness-checks switch statements
 *   against it. For a closed set of string labels that never need iteration, `type`
 *   is always the right choice over `enum`.
 *
 * WHY not `interface` or `object literal`:
 *   `type` is the correct TypeScript construct for a union of literals. `interface`
 *   describes the shape of an object, not a set of allowed values.
 */
export type Dialect = "postgres" | "mysql" | "sqlite" | "mssql";

/**
 * Permission level that controls which SQL statements are allowed at runtime.
 *
 * WHY `type` (string union) and not `enum`:
 *   Same reasoning as Dialect above — erased at compile time, no runtime object,
 *   and exhaustiveness-checked by TypeScript. The three values form a natural
 *   escalating scale (readonly < write < full) that maps cleanly to string
 *   literals a human can read in logs or config files without needing a reverse
 *   lookup table.
 */
export type PermissionMode = "readonly" | "write" | "full";

/**
 * The parsed, normalised configuration object produced by getConnectionConfig().
 * This is the single source of truth that the Express server consumes to build
 * a Knex instance — no raw argv strings survive past this boundary.
 *
 * WHY `interface` and not `type`:
 *   Both can describe an object shape in TypeScript, but `interface` is the
 *   idiomatic choice when:
 *     1. The shape may be extended later (e.g. `interface SSLConfig extends ConnectionConfig`).
 *     2. The object is a data contract between two layers of the system — here,
 *        between the CLI parser and the Express server.
 *     3. Error messages reference the interface name, making them easier to read
 *        than an anonymous `{ dialect: Dialect; host: string; ... }` inline type.
 *   Use `type` when you need a union, intersection, mapped type, or conditional
 *   type — constructs that `interface` cannot express.
 */
export interface ConnectionConfig {
  /** One of the four supported dialects (maps to a knex client name). */
  dialect: Dialect;
  /** Hostname or IP of the database server. Not used for SQLite. */
  host: string;
  /** TCP port of the database server. Not used for SQLite. */
  port: number;
  /** Database name (server dialects) or file path (SQLite). */
  database: string;
  /** Login username. Not used for SQLite. */
  user: string;
  /** Login password. Not used for SQLite. */
  password: string;
  /** SQL permission level for this session. */
  permissionMode: PermissionMode;
}

// ===== CONSTANTS =====

/**
 * Default TCP ports per dialect.
 * Exported so the CLI parser and tests share the same source of truth.
 * SQLite's value is 0 — a sentinel meaning "no port"; the server ignores it.
 *
 * WHY `Record<Dialect, number>`:
 *   `Record<K, V>` is TypeScript's built-in mapped type that creates an object
 *   type where every key in K maps to a value of type V. Using `Record<Dialect, number>`
 *   instead of `{ [key: string]: number }` gives us two guarantees:
 *     1. Exhaustiveness — TypeScript errors if any Dialect value is missing from
 *        the object literal. Adding a new dialect to the union without updating
 *        this map is a compile-time error, not a silent runtime bug.
 *     2. Key narrowing — lookups like DEFAULT_PORTS[dialect] are typed as `number`
 *        (not `number | undefined`) because TypeScript knows every Dialect key
 *        is present. With `noUncheckedIndexedAccess` enabled in tsconfig, this
 *        distinction matters: a plain index signature would return `number | undefined`
 *        and force unnecessary null checks.
 */
export const DEFAULT_PORTS: Record<Dialect, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: 0,
  mssql: 1433,
};
