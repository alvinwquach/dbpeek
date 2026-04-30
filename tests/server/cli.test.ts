// ===== FILE PURPOSE =====
// Unit tests for src/cli/index.ts — specifically the getConnectionConfig() function.
//
// WHY these tests don't spawn a child process:
//   getConnectionConfig() accepts an injectable argv array, so we can call it
//   directly from Node without exec()'ing npx. This keeps tests fast (no
//   process spawning) and gives us precise assertion on the returned object.
//
// HOW argv is structured:
//   process.argv in a real Node process is always ["node", "script", ...args].
//   Commander's .parse() skips the first two elements by default (fromIndex: 2).
//   We match that convention here: argv = ["node", "dbpeek", ...actualArgs].

import { describe, it, expect } from "vitest";
import {
  getConnectionConfig,
  DEFAULT_PORTS,
  type ConnectionConfig,
} from "../../src/cli/index.js";

// ===== HELPERS =====

/**
 * Wraps the raw args in the expected process.argv prefix so tests don't
 * have to repeat ["node", "dbpeek"] in every call.
 *
 * WHY: reduces noise in test cases and makes it obvious which part of the
 * array is the "real" CLI input vs the runtime scaffolding.
 */
function argv(...args: string[]): string[] {
  return ["node", "dbpeek", ...args];
}

// ===== CONNECTION STRING URL PARSING =====

describe("connection string URL parsing", () => {
  // ── postgres:// ────────────────────────────────────────────────────────────

  it("parses a full postgres:// URL", () => {
    const cfg = getConnectionConfig(
      argv("postgres://alice:secret@db.example.com:5433/myapp")
    );
    expect(cfg).toMatchObject<ConnectionConfig>({
      dialect: "postgres",
      host: "db.example.com",
      port: 5433,
      database: "myapp",
      user: "alice",
      password: "secret",
      permissionMode: "readonly",
    });
  });

  it("parses a postgresql:// alias as postgres dialect", () => {
    const cfg = getConnectionConfig(
      argv("postgresql://u:p@localhost/testdb")
    );
    expect(cfg.dialect).toBe("postgres");
    expect(cfg.database).toBe("testdb");
  });

  it("uses the default postgres port (5432) when omitted from URL", () => {
    const cfg = getConnectionConfig(argv("postgres://localhost/mydb"));
    expect(cfg.port).toBe(DEFAULT_PORTS.postgres); // 5432
  });

  // ── mysql:// ───────────────────────────────────────────────────────────────

  it("parses a full mysql:// URL", () => {
    const cfg = getConnectionConfig(
      argv("mysql://root:pass@127.0.0.1:3307/shop")
    );
    expect(cfg).toMatchObject<ConnectionConfig>({
      dialect: "mysql",
      host: "127.0.0.1",
      port: 3307,
      database: "shop",
      user: "root",
      password: "pass",
      permissionMode: "readonly",
    });
  });

  it("parses mysql2:// alias as mysql dialect", () => {
    const cfg = getConnectionConfig(argv("mysql2://localhost/analytics"));
    expect(cfg.dialect).toBe("mysql");
  });

  it("uses the default mysql port (3306) when omitted from URL", () => {
    const cfg = getConnectionConfig(argv("mysql://localhost/db"));
    expect(cfg.port).toBe(DEFAULT_PORTS.mysql); // 3306
  });

  // ── mssql:// ───────────────────────────────────────────────────────────────

  it("parses a full mssql:// URL", () => {
    const cfg = getConnectionConfig(
      argv("mssql://sa:Str0ng!@sqlserver.local:1434/Northwind")
    );
    expect(cfg).toMatchObject<Partial<ConnectionConfig>>({
      dialect: "mssql",
      host: "sqlserver.local",
      port: 1434,
      database: "Northwind",
      user: "sa",
    });
  });

  it("parses sqlserver:// alias as mssql dialect", () => {
    const cfg = getConnectionConfig(
      argv("sqlserver://localhost/AdventureWorks")
    );
    expect(cfg.dialect).toBe("mssql");
  });

  it("uses the default mssql port (1433) when omitted from URL", () => {
    const cfg = getConnectionConfig(argv("mssql://localhost/db"));
    expect(cfg.port).toBe(DEFAULT_PORTS.mssql); // 1433
  });

  // ── edge cases ─────────────────────────────────────────────────────────────

  it("decodes percent-encoded characters in password", () => {
    // "@" in a password must be percent-encoded as %40 in a URL.
    const cfg = getConnectionConfig(
      argv("postgres://user:p%40ssword@localhost/db")
    );
    expect(cfg.password).toBe("p@ssword");
  });

  it("decodes percent-encoded characters in database name", () => {
    const cfg = getConnectionConfig(
      argv("postgres://localhost/my%20database")
    );
    expect(cfg.database).toBe("my database");
  });
});

// ===== INDIVIDUAL FLAGS PARSING =====

describe("individual flags parsing", () => {
  it("parses -d postgres with all flags", () => {
    const cfg = getConnectionConfig(
      argv("-d", "postgres", "-h", "db.local", "-P", "5434", "-D", "app", "-u", "admin", "-p", "pw")
    );
    expect(cfg).toMatchObject<ConnectionConfig>({
      dialect: "postgres",
      host: "db.local",
      port: 5434,
      database: "app",
      user: "admin",
      password: "pw",
      permissionMode: "readonly",
    });
  });

  it("parses -d mysql with port flag", () => {
    const cfg = getConnectionConfig(
      argv("-d", "mysql", "-h", "localhost", "-P", "3306", "-D", "shop")
    );
    expect(cfg.dialect).toBe("mysql");
    expect(cfg.port).toBe(3306);
    expect(cfg.database).toBe("shop");
  });

  it("parses -d mssql with individual flags", () => {
    const cfg = getConnectionConfig(
      argv("-d", "mssql", "-D", "Northwind", "-u", "sa", "-p", "Pa$$w0rd")
    );
    expect(cfg.dialect).toBe("mssql");
    expect(cfg.database).toBe("Northwind");
    expect(cfg.user).toBe("sa");
    expect(cfg.password).toBe("Pa$$w0rd");
  });

  // ── Default host ───────────────────────────────────────────────────────────

  it("defaults host to localhost when -h is not provided", () => {
    const cfg = getConnectionConfig(argv("-d", "postgres", "-D", "mydb"));
    expect(cfg.host).toBe("localhost");
  });

  // ── Default ports per dialect ──────────────────────────────────────────────

  it("defaults postgres port to 5432 when -P is omitted", () => {
    const cfg = getConnectionConfig(argv("-d", "postgres", "-D", "db"));
    expect(cfg.port).toBe(5432);
  });

  it("defaults mysql port to 3306 when -P is omitted", () => {
    const cfg = getConnectionConfig(argv("-d", "mysql", "-D", "db"));
    expect(cfg.port).toBe(3306);
  });

  it("defaults mssql port to 1433 when -P is omitted", () => {
    const cfg = getConnectionConfig(argv("-d", "mssql", "-D", "db"));
    expect(cfg.port).toBe(1433);
  });

  // ── SQLite ─────────────────────────────────────────────────────────────────

  it("parses -d sqlite -D <file path> correctly", () => {
    const cfg = getConnectionConfig(
      argv("-d", "sqlite", "-D", "./data/mydb.sqlite")
    );
    expect(cfg.dialect).toBe("sqlite");
    expect(cfg.database).toBe("./data/mydb.sqlite");
    // Port is the 0 sentinel for SQLite — the server ignores it.
    expect(cfg.port).toBe(DEFAULT_PORTS.sqlite);
  });

  it("parses absolute SQLite file path", () => {
    const cfg = getConnectionConfig(
      argv("-d", "sqlite", "-D", "/var/data/prod.sqlite")
    );
    expect(cfg.database).toBe("/var/data/prod.sqlite");
  });
});

// ===== URL OVERRIDES FLAGS =====

describe("URL values override individual flags when both provided", () => {
  it("URL host overrides -h flag", () => {
    // User passed both a full URL and a conflicting -h flag.
    // The URL wins: its host ("url-host") takes priority over the flag ("flag-host").
    const cfg = getConnectionConfig(
      argv("postgres://url-host/db", "-h", "flag-host")
    );
    expect(cfg.host).toBe("url-host");
  });

  it("URL port overrides -P flag", () => {
    const cfg = getConnectionConfig(
      argv("postgres://localhost:9999/db", "-P", "1111")
    );
    expect(cfg.port).toBe(9999);
  });

  it("URL database overrides -D flag", () => {
    const cfg = getConnectionConfig(
      argv("postgres://localhost/url-db", "-D", "flag-db")
    );
    expect(cfg.database).toBe("url-db");
  });

  it("URL user overrides -u flag", () => {
    const cfg = getConnectionConfig(
      argv("postgres://url-user:pw@localhost/db", "-u", "flag-user")
    );
    expect(cfg.user).toBe("url-user");
  });

  it("URL dialect overrides -d flag", () => {
    // The URL says mysql; the flag says postgres. URL wins.
    const cfg = getConnectionConfig(
      argv("mysql://localhost/db", "-d", "postgres")
    );
    expect(cfg.dialect).toBe("mysql");
  });
});

// ===== PERMISSION MODE FLAGS =====

describe("permission mode flags", () => {
  it("defaults to readonly when neither --write nor --full is given", () => {
    const cfg = getConnectionConfig(argv("-d", "postgres", "-D", "db"));
    expect(cfg.permissionMode).toBe("readonly");
  });

  it("sets permissionMode to write when --write is given", () => {
    const cfg = getConnectionConfig(
      argv("-d", "postgres", "-D", "db", "--write")
    );
    expect(cfg.permissionMode).toBe("write");
  });

  it("sets permissionMode to full when --full is given", () => {
    const cfg = getConnectionConfig(
      argv("-d", "postgres", "-D", "db", "--full")
    );
    expect(cfg.permissionMode).toBe("full");
  });

  it("--full takes precedence over --write when both are given", () => {
    const cfg = getConnectionConfig(
      argv("-d", "postgres", "-D", "db", "--write", "--full")
    );
    expect(cfg.permissionMode).toBe("full");
  });

  it("parses --write with a connection string URL", () => {
    const cfg = getConnectionConfig(
      argv("postgres://localhost/db", "--write")
    );
    expect(cfg.permissionMode).toBe("write");
  });

  it("parses --full with a connection string URL", () => {
    const cfg = getConnectionConfig(
      argv("postgres://localhost/db", "--full")
    );
    expect(cfg.permissionMode).toBe("full");
  });
});

// ===== VALIDATION ERRORS =====

describe("validation errors", () => {
  it("throws when no dialect is provided via flags or URL", () => {
    expect(() =>
      getConnectionConfig(argv("-D", "mydb"))
    ).toThrow(
      "Please specify a database dialect with -d (postgres, mysql, sqlite, mssql)"
    );
  });

  it("throws when no database is provided via flags or URL", () => {
    expect(() =>
      getConnectionConfig(argv("-d", "postgres"))
    ).toThrow(
      "Please specify a database name with -D or in the connection string"
    );
  });

  it("throws with missing dialect message even when other flags are present", () => {
    expect(() =>
      getConnectionConfig(argv("-h", "localhost", "-D", "db", "-u", "alice"))
    ).toThrow(
      "Please specify a database dialect with -d (postgres, mysql, sqlite, mssql)"
    );
  });

  it("throws with missing database message even when dialect is present", () => {
    expect(() =>
      getConnectionConfig(argv("-d", "mysql", "-h", "localhost"))
    ).toThrow(
      "Please specify a database name with -D or in the connection string"
    );
  });

  it("throws on an unsupported URL protocol", () => {
    expect(() =>
      getConnectionConfig(argv("oracle://localhost/xe"))
    ).toThrow(/Unsupported protocol/);
  });

  it("throws on a malformed URL string", () => {
    expect(() =>
      getConnectionConfig(argv("not a url at all"))
    ).toThrow(/Invalid connection string/);
  });

  it("throws on an unknown dialect flag value", () => {
    // commander's argParser fires InvalidArgumentError for bad option values.
    expect(() =>
      getConnectionConfig(argv("-d", "oracle", "-D", "db"))
    ).toThrow(/oracle/);
  });
});
