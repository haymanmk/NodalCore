import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@nodalcore/sdk': resolve('../../packages/sdk/src/index.ts'),
        '@nodalcore/plugin-host': resolve('../../packages/plugin-host/src/index.ts'),
        '@nodalcore/registry-client': resolve('../../packages/registry-client/src/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          webview: resolve('src/preload/webview.ts'),
        },
      },
    },
  },
  renderer: {
    resolve: {
      // Order matters: deep-path aliases must come before the bare-package
      // alias so they win the prefix match. The SDK's main index re-exports
      // grpc-adapter (which imports node:fs/os/path at top level) — fine for
      // the main process, but the renderer build can't bundle Node modules.
      // The deep alias lets renderer code reach connectionSchemas without
      // pulling in the full SDK module graph.
      alias: [
        {
          find: /^@nodalcore\/sdk\/schemas\/connection$/,
          replacement: resolve('../../packages/sdk/src/schemas/connection.ts'),
        },
        { find: /^@nodalcore\/sdk$/, replacement: resolve('../../packages/sdk/src/index.ts') },
        {
          find: /^@nodalcore\/registry-client$/,
          replacement: resolve('../../packages/registry-client/src/index.ts'),
        },
        {
          find: /^@nodalcore\/renderer$/,
          replacement: resolve('../../packages/renderer/src/index.ts'),
        },
      ],
    },
    plugins: [react()],
  },
})
