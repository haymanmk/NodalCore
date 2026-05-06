import { defineConfig } from 'tsup'

export default defineConfig({
  // worker.ts MUST be a separate emit — `loader.ts` forks it as a child
  // process. Bundling it into index.js would prevent fork() from finding it.
  entry: { index: 'src/index.ts', worker: 'src/worker.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  platform: 'node',
})
