/**
 * vite.config.ts
 *
 * WHAT: Vite build configuration for the dbpeek React frontend.
 *
 * WHY: Vite is the build tool / dev server for the React client. This config
 * tells Vite where to find the entry point, where to write the compiled output,
 * and how to proxy API calls to the Express backend during development so the
 * browser's same-origin policy is never tripped.
 *
 * HOW: `npm run dev:client` starts the Vite dev server using this config.
 * `npm run build` compiles the React app into dist/client/ which Express then
 * serves as static files in production via express.static().
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname shim for ES modules (same pattern as src/server/index.ts).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  // ── Plugins ───────────────────────────────────────────────────────────────
  plugins: [
    // Enables JSX/TSX transformation, Fast Refresh (hot module replacement
    // without losing component state), and React-specific optimisations.
    react(),

    // Integrates Tailwind CSS v4 directly into the Vite pipeline so that
    // utility classes are generated and injected at build/dev time without a
    // separate PostCSS step.
    tailwindcss(),
  ],

  // ── Build output ──────────────────────────────────────────────────────────
  build: {
    // Write compiled assets into dist/client/ instead of the default dist/.
    // Express serves this directory via express.static() in production, so the
    // path here must match the one used in src/server/index.ts.
    // Use an absolute path so the output always lands at <repo-root>/dist/client/
    // regardless of the `root` setting above. Express serves this directory via
    // express.static() in src/server/index.ts.
    outDir: path.resolve(__dirname, 'dist/client'),
    // outDir is outside Vite's root (src/client/), so we must opt-in to
    // cleaning it between builds — Vite won't do it automatically.
    emptyOutDir: true,
  },

  // ── Root ──────────────────────────────────────────────────────────────────
  // Tell Vite that src/client/ is the root directory for the frontend app.
  // This is where it looks for index.html, main.tsx, etc.
  root: 'src/client',

  // ── Path aliases ──────────────────────────────────────────────────────────
  // '@' maps to src/client/ so shadcn-generated components can import each
  // other with '@/components/ui/button' instead of fragile relative paths.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/client'),
    },
  },

  // ── Dev-server proxy ──────────────────────────────────────────────────────
  // During development, the Vite dev server runs on http://localhost:5173 and
  // the Express API runs on http://localhost:3000. Without a proxy, every
  // fetch('/api/...') call from the browser would fail with a CORS error
  // because the ports differ.
  //
  // Instead of adding complex CORS logic, we proxy all /api/* requests through
  // the Vite dev server to the Express backend. From the browser's perspective,
  // the requests stay on the same origin (localhost:5173).
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        // NOTE: changeOrigin rewrites the Host header so Express doesn't reject
        // the request as coming from a different host than it expects.
        changeOrigin: true,
      },
    },
  },
});
