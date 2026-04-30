import type { Express } from "express";
import type { Knex } from "../db.js";

// registerRoutes mounts all API route handlers onto the Express app.
// Keeping registration in one place makes it easy to see the full API surface
// at a glance and to apply middleware (auth, rate-limiting) to groups of routes.
export function registerRoutes(app: Express, db: Knex): void {
  // Health check — used by the CLI to confirm the server started successfully
  // and by future load-balancer / Docker health-check probes.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Placeholder: routes will be split into separate files as they grow.
  // e.g.:
  //   app.use("/api/schema", schemaRouter(db));
  //   app.use("/api/query",  queryRouter(db));
  //   app.use("/api/tables", tablesRouter(db));
}
