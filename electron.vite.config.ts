import { defineConfig } from 'electron-vite'
import { build, type Plugin } from 'vite'
import { resolve } from 'node:path'

// The MCP context server (out/main/mcp.js) runs on its own: the app copies that one file to
// <app data>/mcp and Claude Code starts it with plain node. So it is built as a separate,
// self-contained bundle (no shared chunks) after the main build.
const mcpBundle = (): Plugin => ({
  name: 'neural-os-mcp-bundle',
  apply: 'build',
  async closeBundle() {
    await build({
      configFile: false, logLevel: 'warn',
      build: {
        ssr: resolve('src/mcp/server.ts'), outDir: resolve('out/main'), emptyOutDir: false, target: 'node22', minify: false,
        rollupOptions: { output: { format: 'cjs', entryFileNames: 'mcp.js', inlineDynamicImports: true } }
      }
    })
  }
})

export default defineConfig({
  main: { plugins: [mcpBundle()], build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } } },
  preload: {},
  renderer: {
    root: resolve('src/renderer'),
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
