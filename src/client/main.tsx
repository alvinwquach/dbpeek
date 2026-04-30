/**
 * src/client/main.tsx — React entry point.
 *
 * ARCHITECTURE:
 *   This file is the Vite entry point declared in src/client/index.html:
 *     <script type="module" src="/main.tsx"></script>
 *
 *   Vite compiles it (along with all imports) into a hashed bundle written to
 *   dist/client/assets/. Express then serves dist/client/ as static files, so
 *   `npx dbpeek` is the single command that starts the whole tool.
 *
 *   State model:
 *     Server state (API responses) is managed by TanStack Query (QueryClient).
 *     Client-only UI state (tabs, history, view mode) lives in Zustand.
 *     NO localStorage, sessionStorage, or IndexedDB is used anywhere.
 *     When the browser tab is closed, all state is gone. This is intentional:
 *     dbpeek is a read-explore tool, not a persistent workspace.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ===== STYLES =====

// index.css contains `@import "tailwindcss"` (Tailwind v4 entry point).
// Vite processes this through the @tailwindcss/vite plugin, which scans all
// template files at build time and emits only the CSS classes actually used.
import "./index.css";

// ===== APP =====

import App from "./App";

// ===== QUERY CLIENT =====

// A single QueryClient instance for the entire app lifetime.
//
// WHY create it here (module level) rather than inside the component:
//   If QueryClient were created inside a component, it would be re-created on
//   every render, discarding the entire cache and causing unnecessary refetches.
//   At module level it is created once and lives for the full page session.
//
// WHY no defaultOptions overrides here:
//   Each query sets its own staleTime. The /api/status query uses Infinity
//   (connection config is immutable per session). Future queries — schema,
//   table list — will use shorter stale times appropriate to their data.
//   A global default would silently override per-query intent, so we leave
//   the defaults (staleTime: 0, gcTime: 5 min) and set them per-query.
const queryClient = new QueryClient();

// ===== MOUNT =====

// document.getElementById("root") corresponds to the <div id="root"> in
// src/client/index.html. We assert its existence here so that any HTML
// misconfiguration fails loudly at boot, not silently inside a component.
const container = document.getElementById("root");

if (!container) {
  throw new Error(
    "[dbpeek] Root element #root not found. " +
      'Check that src/client/index.html contains <div id="root"></div>.'
  );
}

// QueryClientProvider makes the QueryClient available to every component in
// the tree via React context. It must wrap App (and therefore StatusBar) so
// that useQuery calls inside can access the shared cache.
//
// StrictMode wraps the outermost shell to surface deprecated APIs and
// double-invoke effects in development — it has no effect in production.
createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
