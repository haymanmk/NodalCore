import { defineConfig } from 'tsup'

// Bundle the standalone-tool entry into a single self-contained file so the
// installed copy in ~/.nodalcore/plugins/<id>/ doesn't depend on a populated
// node_modules. The createRequire shim in the banner lets dynamic `require()`
// inside CJS deps (notably @grpc/grpc-js) work from an ESM bundle.
export default defineConfig({
  entry: { tool: 'src/tool.js' },
  outDir: 'bin',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  noExternal: [/.*/],
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __nodalcoreCreateRequire } from "node:module";',
      'const require = __nodalcoreCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  outExtension: () => ({ js: '.js' }),
  clean: true,
  sourcemap: false,
})
