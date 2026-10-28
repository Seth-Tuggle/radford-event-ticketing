/**
 * @file vite.config.js
 * @description Vite build and dev-server configuration for the React SPA.
 *
 * Vite is the build tool and dev server for this project (see package.json
 * scripts: `dev`, `build`, `preview`). Defaults used:
 *   - Dev server runs on http://localhost:5173.
 *   - `npm run build` produces a static bundle in ./dist.
 *   - Files under ./public are copied verbatim to the site root (that is how
 *     venue.html and its assets are served as a separate page alongside the
 *     React SPA entry in index.html).
 *
 * The only plugin we register is @vitejs/plugin-react, which enables:
 *   - JSX/TSX transform via Babel/SWC
 *   - React Fast Refresh during `npm run dev`
 *   - Automatic JSX runtime (no need to import React in every file)
 *
 * Reference: https://vite.dev/config/
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
