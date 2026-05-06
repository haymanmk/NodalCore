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
      alias: {
        '@nodalcore/sdk': resolve('../../packages/sdk/src/index.ts'),
        '@nodalcore/registry-client': resolve('../../packages/registry-client/src/index.ts'),
        '@nodalcore/renderer': resolve('../../packages/renderer/src/index.ts'),
      },
    },
    plugins: [react()],
  },
})
