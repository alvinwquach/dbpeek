/**
 * src/client/utils/parseSelectTable.ts
 *
 * WHAT:
 *   Determines whether a SQL string is a "simple SELECT from a single table"
 *   that the inline cell-edit flow can target with an UPDATE.
 *
 * WHY this matters for cell editing:
 *   The cell-edit flow generates `UPDATE <table> SET <col> = <value> WHERE
 *   <pk> = <pk_value>`. To construct that WHERE clause it needs to know
 *   which table to update. JOINs, sub-queries, and CTEs each ambiguate the
 *   answer:
 *     SELECT * FROM users JOIN orders ON ...   →  which side gets updated?
 *     WITH x AS (SELECT ...) SELECT * FROM x   →  x is virtual; no real table
 *     SELECT (SELECT ...) FROM users           →  the projection is computed
 *
 *   Rather than try to be clever, we accept ONLY queries of the shape
 *     SELECT <projection> FROM <table>
 *   plus optional WHERE / ORDER BY / GROUP BY / HAVING / LIMIT / OFFSET
 *   trailers. Anything richer (JOIN, CTE, sub-SELECT, set operations like
 *   UNION) is rejected with a friendly reason the UI shows on double-click.
 *
 * WHY it's still a regex/string approach (not a real SQL parser):
 *   A real parser is a multi-thousand-line dependency. The cell-edit feature
 *   only needs a yes/no decision; over-strict false negatives are acceptable
 *   ("we couldn't tell — re-run with a simpler SELECT") because they degrade
 *   to read-only safely. A loose match that wrongly OK'd a JOIN would let
 *   the UPDATE target the wrong table — the unsafe failure mode. So this
 *   intentionally errs on the side of refusal.
 *
 * Returned shapes:
 *   { kind: "ok", table }      — single-table SELECT, edit is allowed if PK exists
 *   { kind: "multi" }          — JOIN / sub-SELECT / CTE / UNION — not editable
 *   { kind: "non-select" }     — INSERT / UPDATE / DDL / blank — n/a
 */

// ===== TYPES =====

/** Discriminated result of parsing the SQL. */
export type ParsedSelect =
  | { kind: "ok"; table: string }
  | { kind: "multi" }
  | { kind: "non-select" };

// ===== HELPERS =====

/**
 * stripCommentsAndStrings — replaces every comment / single-quoted string
 * literal with a single space so the structural keyword scan doesn't trip
 * on a JOIN inside a string literal or a /* SELECT ... * / inside a block
 * comment.
 *
 * WHY only single quotes are stripped (not double quotes or backticks):
 *   In SQL-standard usage:
 *     - 'string'        — string literal (safe to strip — could hide keywords)
 *     - "identifier"    — quoted identifier (Postgres / ANSI standard)
 *     - `identifier`    — quoted identifier (MySQL convention)
 *   We need to PRESERVE quoted identifiers because they may be the table
 *   name in the FROM clause we are trying to capture. Stripping them would
 *   erase the very thing we are looking for. This means a column literally
 *   named "select" or `union` could create false-positive multi/CTE
 *   detection — but that's a vanishingly rare case and fails safe (refuses
 *   the edit) rather than allowing an unsafe one.
 *
 *   MySQL with ANSI_QUOTES=OFF lets "foo" mean a string literal — in that
 *   mode a JOIN inside a double-quoted string would not be stripped, again
 *   leading to a false-positive multi result. Safe failure mode by design.
 *
 * WHY a single space rather than empty replacement:
 *   Removing the bytes outright could glue two identifiers together
 *   ("FROM"/* x * /"users" → "FROMusers" — the FROM keyword disappears).
 *   Replacing with a space preserves token boundaries with one cheap pass.
 */
function stripCommentsAndStrings(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment: -- … \n  → swallow up to (and including) the newline.
    if (ch === "-" && next === "-") {
      out += " ";
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    // Block comment: /* … */  → swallow until the closing */ (or EOF).
    if (ch === "/" && next === "*") {
      out += " ";
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Single-quoted string literal — strip body so an embedded JOIN /
    // UNION / etc. inside the string doesn't get classified as structural.
    // Doubled-quote ('' inside '...') and backslash escapes are honoured
    // so a quote inside the literal doesn't terminate the string early.
    if (ch === "'") {
      out += " ";
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "\\" && i + 1 < sql.length) {
          // Backslash escape (MySQL extension). Skip both chars so we
          // don't mistake a \' for a closing quote.
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += ch ?? "";
    i++;
  }
  return out;
}

// ===== PUBLIC API =====

/**
 * parseSelectTable — analyses a SQL string and tells the caller whether
 * inline cell editing is safe and, if so, against which table.
 *
 * @param rawSql - The exact SQL string that produced the result rows.
 * @returns A discriminated ParsedSelect — see the file header for shapes.
 */
export function parseSelectTable(rawSql: string): ParsedSelect {
  // Defensive: the caller may pass an empty/whitespace SQL when no query
  // has run yet. Treat that the same as "not a SELECT".
  if (!rawSql || rawSql.trim() === "") return { kind: "non-select" };

  // Strip out anything that could contain a misleading keyword (a comment
  // discussing JOINs, a string literal containing "FROM", etc.) BEFORE
  // structural matching.
  const cleaned = stripCommentsAndStrings(rawSql).trim();

  // Discard a trailing semicolon — common in pasted snippets.
  const trimmed = cleaned.replace(/;\s*$/, "").trim();

  // Must start with SELECT (case-insensitive). WITH (CTE), INSERT/UPDATE/
  // DELETE/etc. all fall to non-select or multi.
  if (/^with\b/i.test(trimmed)) return { kind: "multi" };
  if (!/^select\b/i.test(trimmed)) return { kind: "non-select" };

  // ── Reject unambiguously multi-table constructs ─────────────────────────
  // \b ensures we don't match "JOINED" or "UNIONS" inside a column alias.
  // This is intentionally aggressive — see the file header rationale.
  if (/\bjoin\b/i.test(trimmed)) return { kind: "multi" };
  if (/\bunion\b/i.test(trimmed)) return { kind: "multi" };
  if (/\bintersect\b/i.test(trimmed)) return { kind: "multi" };
  if (/\bexcept\b/i.test(trimmed)) return { kind: "multi" };

  // Detect nested SELECTs (sub-queries) — once comments and strings are
  // stripped, a second occurrence of the SELECT keyword can only be from
  // a sub-query in the projection or WHERE clause.
  const selectMatches = trimmed.match(/\bselect\b/gi);
  if (selectMatches && selectMatches.length > 1) {
    return { kind: "multi" };
  }

  // ── Pull the table name from the FROM clause ────────────────────────────
  // Accepts:
  //   FROM users
  //   FROM "users"
  //   FROM `users`
  //   FROM public.users / FROM "public"."users" — schema-qualified
  // Rejects (treated as multi) anything more complex by virtue of the
  // multi-keyword guards above.
  //
  // The capture group strips one layer of optional quoting. If a schema
  // prefix is present we keep ONLY the table identifier (everything after
  // the dot) — the cell-edit endpoint scopes by table name in the active
  // schema, and the schema sidebar doesn't currently surface qualified names.
  const fromMatch = trimmed.match(
    /\bfrom\s+(?:"([^"]+)"|`([^`]+)`|([A-Za-z_][\w$]*))(?:\s*\.\s*(?:"([^"]+)"|`([^`]+)`|([A-Za-z_][\w$]*)))?/i
  );
  if (!fromMatch) return { kind: "multi" };

  // Prefer the qualified-half capture groups (positions 4-6) when a schema
  // prefix was present; otherwise fall back to the bare identifier (1-3).
  const qualifiedTable = fromMatch[4] ?? fromMatch[5] ?? fromMatch[6];
  const bareTable = fromMatch[1] ?? fromMatch[2] ?? fromMatch[3];
  const table = qualifiedTable ?? bareTable;
  if (!table) return { kind: "multi" };

  // After the FROM-table token, allow only known clause continuations.
  // A comma there would mean the legacy implicit-join syntax (FROM a, b).
  const afterFromIndex =
    fromMatch.index !== undefined ? fromMatch.index + fromMatch[0].length : -1;
  if (afterFromIndex >= 0) {
    const tail = trimmed.slice(afterFromIndex).trim();
    // Empty tail → bare "SELECT … FROM table" → fine.
    if (tail.length > 0) {
      // Reject implicit-join shape "FROM a, b".
      if (/^,/.test(tail)) return { kind: "multi" };
      // Allow only standard trailing clauses.
      if (
        !/^(where|group\s+by|order\s+by|having|limit|offset|fetch|for|window)\b/i.test(
          tail
        )
      ) {
        return { kind: "multi" };
      }
    }
  }

  return { kind: "ok", table };
}
