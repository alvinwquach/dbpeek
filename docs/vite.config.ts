/**
 * vite.config.ts — Vite config for dbpeek docs site.
 *
 * CRITICAL: base: '/docs/' ensures all asset URLs and routes resolve correctly
 * when served at dbpeek.com/docs/*. Without this, assets load from / and 404.
 *
 * MDX is processed first (enforce: 'pre') so Vite sees .mdx files as
 * JSX-like modules before the React plugin transforms them. The order is:
 *   1. MDX plugin (enforce: 'pre') — converts .mdx → JSX
 *   2. Tailwind plugin — processes CSS @theme and utility classes
 *   3. React plugin — handles JSX/TSX (includes .mdx via the include option)
 *
 * We omit @shikijs/rehype here to avoid SSR/bundling issues — syntax
 * highlighting is applied at the CodeBlock component level using shiki's
 * browser API instead.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { resolve } from 'path';

export default defineConfig({
  /**
   * base: '/docs/' tells Vite to prefix all asset imports and the public
   * directory with /docs/. React Router's basename="/docs" mirrors this
   * so client-side routing stays in sync with the asset base path.
   */
  base: '/docs/',
  plugins: [
    {
      /**
       * enforce: 'pre' ensures MDX runs before Vite's internal transform
       * pipeline. Without this, Vite would try to parse .mdx as plain JS
       * and fail on the Markdown syntax.
       */
      enforce: 'pre',
      ...mdx({
        /**
         * remarkGfm adds GitHub Flavored Markdown support: tables, task lists,
         * strikethrough, and autolinks. Essential for docs-style content.
         */
        remarkPlugins: [
          // remarkFrontmatter tells the MDX parser to recognise the ---
          // block as YAML metadata and strip it from the rendered output.
          // Without this plugin, the --- becomes an <hr> and the YAML
          // key: "value" lines render as visible paragraph text.
          remarkFrontmatter,
          remarkGfm,
        ],
        rehypePlugins: [
          /**
           * rehypeSlug adds id attributes to all headings based on their
           * text content. This enables anchor links and the scroll-spy TOC.
           */
          rehypeSlug,
          /**
           * rehypeAutolinkHeadings wraps headings in anchor tags so users
           * can click headings to get a shareable URL. 'wrap' mode wraps
           * the entire heading text in an <a> rather than prepending an icon.
           */
          [rehypeAutolinkHeadings, { behavior: 'wrap' }],
        ],
        /**
         * providerImportSource enables the MDXProvider to inject custom
         * component mappings (h1 → DocH1, code → CodeBlock, etc.) without
         * every .mdx file having to import them explicitly.
         */
        providerImportSource: '@mdx-js/react',
      }),
    },
    tailwindcss(),
    /**
     * include .mdx so the React plugin applies JSX transform to MDX output.
     * Without this, arrow function components in MDX would not compile.
     */
    react({ include: /\.(jsx|tsx|mdx)$/ }),
  ],
  resolve: {
    /**
     * @/ maps to src/ — mirrors the tsconfig paths entry so TypeScript
     * type resolution and Vite bundle resolution agree on what @/ means.
     */
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
