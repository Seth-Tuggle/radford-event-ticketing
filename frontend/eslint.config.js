/**
 * @file eslint.config.js
 * @description ESLint 9 flat configuration for the Radford Events Ticketing SPA.
 *
 * Layers applied to every .js / .jsx file under the project:
 *   - @eslint/js "recommended" — core JavaScript correctness rules.
 *   - eslint-plugin-react-hooks (flat "recommended") — enforces the Rules of
 *     Hooks (no conditional hooks, exhaustive-deps on useEffect, etc.).
 *   - eslint-plugin-react-refresh (Vite preset) — catches module shapes that
 *     break Fast Refresh during `npm run dev`.
 *
 * Custom rule tweaks:
 *   - `no-unused-vars` is promoted to an error, but identifiers that begin with
 *     an uppercase letter or underscore are ignored. This lets us keep unused
 *     React component imports (JSX-agnostic analyzers can't see their usage)
 *     and deliberately-unused destructured values prefixed with `_`.
 *
 * The `dist/` directory (Vite production output) is globally ignored so lint
 * never touches bundled/minified files.
 */
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Never lint build output.
  globalIgnores(['dist']),
  {
    // Apply this configuration block to all JS and JSX source files.
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      // Target modern evergreen browsers; Vite handles any required transpile.
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Treat unused variables as errors, but allow `^[A-Z_]`-prefixed names
      // (components, constants, intentionally-ignored destructured values).
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
])
