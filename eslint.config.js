// ESLint flat config (ESLint 9+).
// The flat config format replaces .eslintrc.* files and uses plain JS modules
// instead of a JSON DSL, which means comments, dynamic rules, and imports all work.

import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  // 1. ESLint's own recommended ruleset: catches obvious JS bugs.
  js.configs.recommended,

  {
    // Apply TypeScript-specific rules to all .ts files in src/ and tests/.
    files: ["src/**/*.ts", "tests/**/*.ts"],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // "project" enables type-aware lint rules (e.g. no-floating-promises).
        // These rules are slower because they require a full type-check pass,
        // but they catch bugs that purely syntactic rules cannot.
        project: "./tsconfig.json",
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },

    plugins: {
      "@typescript-eslint": tsPlugin,
    },

    rules: {
      // Spread in the recommended TS rules, then override selectively below.
      ...tsPlugin.configs.recommended.rules,

      // Require explicit return types on functions exported from modules.
      // Prevents API surface types from accidentally widening (e.g. returning
      // `any` when a specific type was intended).
      "@typescript-eslint/explicit-module-boundary-types": "warn",

      // Allow `any` in a few specific, documented places (e.g. raw SQL row
      // results from knex which are typed as `any[]` by the library).
      "@typescript-eslint/no-explicit-any": "warn",

      // Require that Promises returned from async functions are awaited or
      // explicitly handled. Unhandled rejections silently crash the process.
      "@typescript-eslint/no-floating-promises": "error",

      // Disallow unused variables, but allow variables prefixed with _ to
      // signal "intentionally unused" (e.g. Express's `_req` in error handlers).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },

  {
    // Ignore compiled output and dependency directories.
    ignores: ["dist/", "node_modules/", "coverage/"],
  },
];
