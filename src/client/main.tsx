/**
 * src/client/main.tsx
 *
 * WHAT: React entry point — mounts the App component into the #root DOM node.
 *
 * WHY: Vite needs a single JavaScript/TypeScript module as its entry point.
 * This file is that entry point: it imports the global CSS, bootstraps React,
 * and renders the root <App /> component.
 *
 * HOW: Referenced by src/client/index.html via <script type="module" src="/main.tsx">.
 * Imports App from src/client/App.tsx and global styles from src/client/index.css.
 * No other file imports main.tsx — it is the top of the dependency tree.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// ── Mount ─────────────────────────────────────────────────────────────────────

// Locate the #root element defined in index.html.
// We assert non-null with ! because we control index.html and know #root exists.
// If it's ever missing (e.g. someone edits index.html), we want an explicit crash
// here rather than a confusing error deep inside React's reconciler.
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error(
    '[dbpeek] Could not find #root element in index.html. ' +
      'Make sure index.html contains <div id="root"></div>.'
  );
}

// createRoot is the React 18+ API for concurrent-mode rendering.
// It replaces the legacy ReactDOM.render() call.
const root = createRoot(rootElement);

root.render(
  // StrictMode renders every component twice in development to help catch
  // side-effects that should be idempotent (e.g. missing cleanup in useEffect).
  // It has no effect in production builds.
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
