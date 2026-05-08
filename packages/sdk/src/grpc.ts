/**
 * gRPC transport entry point — separate subpath so device-bridge plugins
 * (which use IPC and never call `createGrpcTransport`) don't pull
 * `@grpc/grpc-js` and `@grpc/proto-loader` into their bundle.
 *
 * Standalone-tool plugins:
 *
 * ```ts
 * import { createGrpcTransport } from '@nodalcore/sdk/grpc'
 * import { createExtensionContext } from '@nodalcore/sdk'
 * ```
 *
 * The bare `@nodalcore/sdk` entry intentionally does NOT re-export this —
 * static re-exports drag the gRPC modules into every consumer's module
 * graph regardless of which functions they actually use, breaking
 * `noExternal: [/.*\/]` bundles for device-bridge plugins.
 */
export { createGrpcTransport } from './host/grpc-adapter.js'
