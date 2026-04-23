import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_PLATFORM': JSON.stringify('web'),
  },
  resolve: {
    alias: {
      '@nodalcore/sdk': resolve('../../packages/sdk/src/index.ts'),
      '@nodalcore/registry-client': resolve('../../packages/registry-client/src/index.ts'),
      '@nodalcore/renderer': resolve('../../packages/renderer/src/index.ts'),
    },
  },
})
