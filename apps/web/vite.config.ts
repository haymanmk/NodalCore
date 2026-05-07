import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_PLATFORM': JSON.stringify('web'),
  },
  resolve: {
    // Order matters: deep-path aliases must come before the bare-package
    // alias so they win the prefix match. Without this, a renderer import
    // like `@nodalcore/sdk/schemas/connection` would expand to
    // `<sdk>/src/index.ts/schemas/connection` (ENOTDIR).
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
})
