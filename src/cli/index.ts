#!/usr/bin/env node
// ^^^ This "shebang" line tells the operating system to run this file with Node.js
// when it's executed directly from the terminal (e.g. ./dist/cli/index.js).
// Without it, the OS wouldn't know what program to use to run the file.

/**
 * src/cli/index.ts
 *
 * Entry point for the dbpeek CLI binary.
 * This file is what runs when a user types `dbpeek` in their terminal.
 *
 * What is Commander?
 *   Commander is a library that makes it easy to build command-line tools.
 *   It handles parsing arguments (e.g. `dbpeek connect postgres://...`),
 *   generating --help output, and dispatching to the right function.
 *
 * How the pieces connect:
 *   CLI (this file)
 *     → detects which database the user wants
 *     → calls createConnection() in src/server/db.ts to set up the DB
 *     → starts the Express server in src/server/index.ts
 *     → opens the browser so the user sees the UI immediately
 *
 * Pseudocode:
 *   1. Set up the root Commander program (name, description, version)
 *   2. Register sub-commands:
 *      - connect <connection-string>
 *          a. Parse the connection string to detect the database type (pg, mysql, sqlite, etc.)
 *          b. Create a Knex connection via src/server/db.ts
 *          c. Start the Express server (src/server/index.ts)
 *          d. Open the browser to the local UI
 *   3. Parse argv so Commander dispatches to the right command
 */

import { Command } from 'commander';

// new Command() creates the root program object.
// All sub-commands and options are attached to this.
const program = new Command();

program
  .name('dbpeek')                                                    // the name shown in --help
  .description('Connect to any database and explore it in your browser')
  .version('0.1.0');                                                 // printed by --version flag

program
  .command('connect')
  .description('Connect to a database')
  // <connection-string> is a required positional argument — the angle brackets mean required.
  // It follows the standard database URL format:
  //   scheme://username:password@host:port/database_name
  // Examples:
  //   postgres://user:pass@localhost:5432/mydb
  //   mysql://user:pass@localhost:3306/mydb
  //   sqlite:///absolute/path/to/db.sqlite   (three slashes = absolute path)
  .argument('<connection-string>', 'Database connection string')
  .action((_connectionString: string) => {
    // This function runs when the user types: dbpeek connect <connection-string>
    // The underscore prefix on _connectionString means it's intentionally unused for now.

    // TODO (implement these steps in order):
    //   1. Parse the scheme from _connectionString (e.g. "postgres" → client = "pg")
    //      Hint: new URL(_connectionString).protocol strips the scheme
    //   2. Call createConnection({ client, connectionString }) from src/server/db.ts
    //   3. Pass the Knex instance into the Express server so routes can use it
    //   4. Call open('http://localhost:3000') from the `open` package to launch the browser
    console.log('connecting...');
  });

// program.parse() reads process.argv (the raw terminal arguments) and
// routes execution to the matching .action() callback above.
// This must be called last, after all commands are registered.
program.parse();
