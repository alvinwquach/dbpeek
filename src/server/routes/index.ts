/**
 * src/server/routes/index.ts
 *
 * Root API router — collects and re-exports all route modules so
 * src/server/index.ts only needs a single import to mount the full API.
 *
 * What is a Router?
 *   In Express, a Router is a mini-app that holds a group of related routes.
 *   You can think of it like a folder — instead of defining every route in
 *   server/index.ts, you group them by feature (tables, queries, schemas...)
 *   and mount them all here under a shared /api prefix.
 *
 * How routing works end-to-end:
 *   Browser  →  GET /api/tables
 *   server/index.ts  →  app.use('/api', router)   ← mounts this file
 *   routes/index.ts  →  router.use('/tables', tablesRouter)
 *   routes/tables.ts →  handles the actual request and returns data
 *
 * Pseudocode:
 *   1. Create an Express Router instance
 *   2. Mount child routers for each feature area, e.g.:
 *        router.use('/tables',  tablesRouter)   // list / describe tables
 *        router.use('/query',   queryRouter)    // run ad-hoc SQL
 *        router.use('/schemas', schemasRouter)  // inspect schemas
 *   3. Export the combined router so server/index.ts can mount it
 *
 * How to add a new route group (step-by-step for new contributors):
 *   a. Create a new file in src/server/routes/, e.g. src/server/routes/tables.ts
 *   b. Inside that file, create a Router and attach your handlers:
 *        import { Router } from 'express';
 *        const router = Router();
 *        router.get('/', (req, res) => { res.json({ tables: [] }); });
 *        export default router;
 *   c. Import your new router here and mount it:
 *        import tablesRouter from './tables.js';
 *        router.use('/tables', tablesRouter);
 *      Now GET /api/tables will reach your handler.
 */

import { Router } from 'express';

// Create the root router that server/index.ts will mount under /api.
// All routes registered below will be prefixed with /api automatically.
const router = Router();

// TODO: import and mount feature routers here as they are built out.
// See the "How to add a new route group" section above for step-by-step instructions.

export default router;
