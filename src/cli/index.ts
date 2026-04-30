#!/usr/bin/env node
// The shebang above is stripped by tsup during bundling but is preserved in the
// dist/cli/index.js output via tsup's `banner` option (or added manually).
// Without it, `npx dbpeek` would fail on Unix systems because the OS would try
// to execute the file as a shell script instead of passing it to Node.

import { program } from "commander";
import { createServer } from "../server/index.js";
import open from "open";

// Read version from package.json at runtime so we never have to update it in
// two places. Node16 ESM does not support named imports from JSON, so we import
// the whole object and destructure. The `assert { type: "json" }` import
// attribute is required for native Node ESM JSON imports.
import pkg from "../../package.json" with { type: "json" };
const { version } = pkg;

// Default port for the local Express server.
// Users can override with --port if 4000 is already taken.
const DEFAULT_PORT = 4000;

program
  .name("dbpeek")
  .description(
    "Connect to any database and explore it in your browser. One command, nothing to install."
  )
  .version(version)
  // The connection string is a positional argument, not a flag, so the user
  // can write `npx dbpeek postgres://...` without any flag names.
  .argument("<connection-string>", "Database connection string")
  .option(
    "-p, --port <number>",
    "Port for the local web server",
    String(DEFAULT_PORT)
  )
  // --no-open suppresses the automatic browser launch, useful in headless
  // environments like CI or Docker where there is no display server.
  .option("--no-open", "Do not open the browser automatically")
  .action(async (connectionString: string, options: { port: string; open: boolean }) => {
    const port = Number(options.port);

    if (Number.isNaN(port) || port < 1 || port > 65535) {
      console.error(`Invalid port: ${options.port}`);
      process.exit(1);
    }

    const app = await createServer(connectionString);

    app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`dbpeek running at ${url}`);

      if (options.open) {
        // open() is fire-and-forget; failures (e.g. no browser installed)
        // are non-fatal — the URL is already printed so the user can open it manually.
        open(url).catch(() => {});
      }
    });
  });

program.parse(process.argv);
