import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    // Deep subpath export — kept as its own bundle so renderer-side
    // consumers can import the schemas without dragging the full SDK
    // module graph (which includes Node-only host helpers like grpc-adapter).
    'src/schemas/connection.ts',
    // gRPC transport — separate bundle so the bare `@nodalcore/sdk` entry
    // doesn't pull @grpc/grpc-js + @grpc/proto-loader into device-bridge
    // plugin bundles (`noExternal: [/.*\/]`). Standalone-tool plugins
    // import this explicitly via `@nodalcore/sdk/grpc`.
    'src/grpc.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
})
