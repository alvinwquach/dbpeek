/**
 * Formats SQL by uppercasing keywords and adding newlines after major clauses.
 * Uses simple regex matching, not a full parser.
 */
export function formatSql(sql: string): string {
  if (!sql.trim()) return sql;

  const keywords = [
    "SELECT",
    "FROM",
    "WHERE",
    "GROUP BY",
    "HAVING",
    "ORDER BY",
    "LIMIT",
    "OFFSET",
    "JOIN",
    "INNER JOIN",
    "LEFT JOIN",
    "RIGHT JOIN",
    "FULL JOIN",
    "CROSS JOIN",
    "ON",
    "AND",
    "OR",
    "UNION",
    "UNION ALL",
    "EXCEPT",
    "INTERSECT",
    "WITH",
    "INSERT",
    "INTO",
    "VALUES",
    "UPDATE",
    "SET",
    "DELETE",
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "AS",
    "DISTINCT",
  ];

  let formatted = sql;

  // Uppercase keywords (case-insensitive match)
  keywords.forEach((keyword) => {
    const regex = new RegExp(`\\b${keyword}\\b`, "gi");
    formatted = formatted.replace(regex, keyword);
  });

  // Add newlines before major clauses (must be done in order to handle multi-word clauses first)
  const majorClauses = [
    "UNION ALL",
    "INNER JOIN",
    "LEFT JOIN",
    "RIGHT JOIN",
    "FULL JOIN",
    "CROSS JOIN",
    "GROUP BY",
    "ORDER BY",
    "UNION",
    "EXCEPT",
    "INTERSECT",
    "SELECT",
    "FROM",
    "WHERE",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "WITH",
  ];

  majorClauses.forEach((clause) => {
    // Add newline before the clause (but preserve existing newlines)
    const regex = new RegExp(`\\s+${clause}\\b`, "g");
    formatted = formatted.replace(regex, `\n${clause}`);
  });

  // Clean up excessive whitespace while preserving intentional newlines
  formatted = formatted
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return formatted.trim();
}
