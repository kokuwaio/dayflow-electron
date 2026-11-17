import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
    plugins: [react()]
  }
})
