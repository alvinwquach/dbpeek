import { defineConfig } from "vite";

// Vite is responsible exclusively for the React frontend (src/client/).
// It is NOT used for the CLI or Express server — tsup handles those.
//
// During development:
//   `vite` starts a dev server on port 5173 with HMR.
//   API requests are proxied to the Express server on port 4000 so that
//   the browser never hits a CORS wall.
//
// For production:
//   `vite build` compiles src/client/ → dist/client/.
//   Express then serves dist/client/ as static files, so the user only
//   needs a single `npx dbpeek` command — no separate frontend server.

export default defineConfig({
  // root tells Vite where to find index.html and resolve relative paths from.
  // Defaults to the project root; we'll move it to src/client/ once we
  // scaffold the React app.
  // root: "src/client",

  build: {
    // Emit the compiled frontend into dist/client/ so that Express can serve
    // it with `express.static('dist/client')` alongside the API routes.
    outDir: "dist/client",

    // Keep the outDir relative to the project root, not to `root` above.
    // This prevents Vite from resolving outDir relative to src/client/ once
    // we update the root option.
    emptyOutDir: true,
  },

  server: {
    // During `vite dev`, forward all /api/* requests to the Express process.
    // This avoids CORS issues and means the React code never hard-codes a port.
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
