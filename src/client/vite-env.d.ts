/**
 * src/client/vite-env.d.ts
 *
 * WHAT: Type declarations that fill the gap between Vite's runtime capabilities
 * and what TypeScript knows about at compile time.
 *
 * WHY: Vite can import CSS, images, SVGs, etc. directly in JS/TS files. TypeScript
 * has no built-in knowledge of these — it only understands .ts/.tsx modules. Without
 * this file, `import './index.css'` produces a TS error even though Vite handles it
 * fine at runtime and build time.
 *
 * HOW: The triple-slash reference pulls in Vite's pre-written ambient declarations
 * (node_modules/vite/client.d.ts), which tell TypeScript that CSS/asset imports are
 * valid and what types they resolve to (e.g. `import url from './logo.svg'` → string).
 */

/// <reference types="vite/client" />
