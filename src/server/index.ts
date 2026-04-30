import express from "express";
import cors from "cors";
import { createConnection } from "./db.js";
import { registerRoutes } from "./routes/index.js";

// createServer is the programmatic entry point for dbpeek.
// It accepts a connection string, wires up the Express app, and returns it.
// The CLI calls createServer and then calls app.listen(); advanced users can
// do the same to embed dbpeek inside an existing Node server.
export async function createServer(connectionString: string) {
  // Validate and establish the database connection before binding to a port.
  // If the connection string is malformed or the database is unreachable, we
  // want to fail fast with a clear error rather than starting a server that
  // returns 500s on every request.
  const db = await createConnection(connectionString);

  const app = express();

  // Parse JSON request bodies. The 10mb limit is generous for a dev tool;
  // real query payloads are tiny, but we leave room for large schema imports.
  app.use(express.json({ limit: "10mb" }));

  // Enable CORS for all origins during development so that the Vite dev server
  // (port 5173) can call the API (port 4000) without browser security errors.
  // In production, both are served from the same origin so CORS is irrelevant,
  // but having it enabled doesn't hurt.
  app.use(cors());

  registerRoutes(app, db);

  return app;
}
