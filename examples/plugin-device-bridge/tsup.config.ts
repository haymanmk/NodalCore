import { defineConfig } from 'tsup'

// Bundle the device-bridge entry the same way the standalone-tool does so
// the installed copy at ~/.nodalcore/plugins/<id>/dist/index.js doesn't
// depend on a populated node_modules. The createRequire banner lets any
// transitive CJS deps (the SDK pulls in @grpc/grpc-js for the gRPC
// transport, which the device-bridge tree-shakes out but its loader still
// asks for) work from an ESM bundle.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  noExternal: [/.*/],
  banner: {
    js: [
      'import { createRequire as __nodalcoreCreateRequire } from "node:module";',
      'const require = __nodalcoreCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  dts: true,
  sourcemap: false,
  clean: true,
})
