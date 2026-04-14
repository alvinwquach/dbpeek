/**
 * src/server/index.ts
 *
 * Entry point for the dbpeek Express server.
 *
 * What is Express?
 *   Express is a Node.js framework for building HTTP servers. You register
 *   "routes" (URL paths) and Express calls your code when a request comes in.
 *
 * How this fits into dbpeek:
 *   The CLI (src/cli/index.ts) starts this server when the user runs
 *   `dbpeek connect <connection-string>`. The React frontend then talks to
 *   this server to fetch table lists, run queries, etc.
 *
 * Pseudocode:
 *   1. Create an Express app
 *   2. Enable CORS so the React frontend (served separately in dev) can talk to this server
 *   3. Parse incoming JSON request bodies so route handlers can read req.body
 *   4. Register routes:
 *      - GET /health → quick liveness check (useful for Docker, CI, and contributors debugging)
 *      - (TODO) Mount API routes from src/server/routes/index.ts
 *   5. Start listening on PORT (defaults to 3000, override via the PORT env var)
 */

import express from 'express';
import cors from 'cors';

// express() creates a new application instance.
// Think of it as the container that holds all your routes and middleware.
const app = express();

// Read PORT from the environment if set, otherwise default to 3000.
// parseInt(..., 10) converts the string "3000" to the number 3000.
// The ", 10" tells parseInt to use base-10 (decimal) — always include it to avoid bugs.
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// CORS (Cross-Origin Resource Sharing) is a browser security rule that blocks
// requests made from one URL (e.g. http://localhost:5173) to a different URL
// (e.g. http://localhost:3000). Since the Vite dev server and this API server
// run on different ports, we must explicitly allow it.
app.use(cors());

// Middleware that reads the raw JSON body of incoming requests and attaches
// it as a plain JavaScript object at req.body so route handlers can use it.
// Without this, req.body would be undefined for POST/PATCH requests.
app.use(express.json());

// Health check endpoint — any caller can hit GET /health to confirm the server
// is running and reachable. Returns { status: 'ok' } as JSON.
// Useful for: Docker HEALTHCHECK instructions, CI smoke tests, and local debugging.
app.get('/health', (_req, res) => {
  // The underscore prefix on _req is a convention meaning "this parameter exists
  // but we don't use it in this handler"
  res.json({ status: 'ok' });
});

// TODO: mount database API routes here once src/server/routes/index.ts is filled out, e.g.:
//   import router from './routes/index.js';
//   app.use('/api', router);
//   This will make all routes in routes/index.ts available under the /api prefix.

// app.listen() starts the HTTP server on the given port.
// The callback runs once the server is ready to accept connections.
app.listen(PORT, () => {
  console.log(`dbpeek server running on http://localhost:${PORT}`);
});

export default app;
