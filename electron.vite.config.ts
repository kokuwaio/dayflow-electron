import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * `make dev` only: React Fast Refresh injects an inline module script, which
 * the page's script-src 'self' blocks. Builds keep the strict policy.
 */
const devInlineScripts: Plugin = {
  name: 'dev-inline-scripts',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      // The CLI and MCP server (out/main/cli.js) ship with the app and run in Electron's Node mode.
      rolldownOptions: { input: { index: resolve('src/main/index.ts'), cli: resolve('src/cli/index.ts') } }
    }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), devInlineScripts]
  }
})
