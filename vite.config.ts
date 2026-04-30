import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// ─────────────────────────────────────────────────────────────────────────────
// VITE CONFIG — React frontend only
//
// ARCHITECTURE:
//   Vite is responsible EXCLUSIVELY for the React frontend (src/client/).
//   It is NOT used for the CLI or Express server — tsup handles those.
//
//   During development:
//     `vite` (or `npm run dev:client`) starts a dev server on port 5173 with HMR.
//     All /api/* requests are proxied to the Express server on port 4000 so the
//     browser never hits a CORS wall.
//
//   For production:
//     `vite build` compiles src/client/ → dist/client/.
//     Express then serves dist/client/ as static files, so `npx dbpeek` is the
//     only command the user needs — no separate frontend process.
//
// TAILWIND v4:
//   The @tailwindcss/vite plugin handles everything. No tailwind.config.ts needed.
//   The CSS entry point just declares: @import "tailwindcss"
//
// JSX:
//   Vite's built-in esbuild transform handles JSX. We configure jsxImportSource
//   so esbuild uses the React 17+ automatic JSX runtime (no explicit React import
//   needed in every file). This avoids needing @vitejs/plugin-react (which has
//   incompatible peer deps with Vite 5.x at time of writing).
// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  // root tells Vite where index.html lives and where relative asset paths are
  // resolved from. src/client/ holds the entire SPA entry point.
  root: "src/client",

  // ── Plugins ────────────────────────────────────────────────────────────────

  plugins: [
    // Tailwind v4 Vite plugin: scans template files for class names and
    // generates the CSS at build time and on-demand during dev.
    // [source: Tailwind CSS — Installing Tailwind CSS as a Vite plugin]
    tailwindcss(),
  ],

  // ── esbuild JSX ────────────────────────────────────────────────────────────

  esbuild: {
    // Use the React 17+ "automatic" JSX runtime. This makes esbuild inject
    // `import { jsx as _jsx } from "react/jsx-runtime"` automatically, so
    // TSX files don't need `import React from "react"` at the top.
    jsxImportSource: "react",
  },

  // ── Build ──────────────────────────────────────────────────────────────────

  build: {
    // outDir is relative to `root` (src/client/). We go up two levels to land
    // in dist/client/ at the project root, where Express serves it.
    //
    // WHY NOT "dist/client": when root is set to src/client, Vite resolves
    // outDir relative to root, so "dist/client" would expand to
    // src/client/dist/client — wrong. "../../dist/client" is explicit.
    outDir: "../../dist/client",

    // emptyOutDir: true clears dist/client/ before each build. This is required
    // when outDir is outside of root (Vite would otherwise refuse to clear it as
    // a safety measure against accidental deletion).
    emptyOutDir: true,
  },

  // ── Dev server ─────────────────────────────────────────────────────────────

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
