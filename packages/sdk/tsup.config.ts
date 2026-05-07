import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    // Deep subpath export — kept as its own bundle so renderer-side
    // consumers can import the schemas without dragging the full SDK
    // module graph (which includes Node-only host helpers like grpc-adapter).
    'src/schemas/connection.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
})
