/// <reference types="vite/client" />

/**
 * vite-env.d.ts — Ambient type declarations for the docs site.
 *
 * WHAT: Tells TypeScript how to type-check .mdx imports.
 *
 * WHY: Without this declaration, TypeScript would error on every MDX import
 * in App.tsx because it doesn't know that .mdx files export React components.
 * @mdx-js/rollup transforms .mdx at build time, but TypeScript needs a type
 * declaration to understand what the import returns at type-check time.
 *
 * HOW: The ComponentType<Record<string, unknown>> type is correct for MDX —
 * MDX components accept arbitrary props (passed through from the parent).
 * Using ComponentType<unknown> would reject JSX; Record<string, unknown>
 * allows any prop without sacrificing type safety in the component map.
 */

declare module '*.mdx' {
  import { type ComponentType } from 'react';
  /** Default export of an MDX file is a React component. */
  const MDXComponent: ComponentType<Record<string, unknown>>;
  export default MDXComponent;
}
