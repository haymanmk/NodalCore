export type { Transport, RequestHandler } from './transport.js'
export type {
  ExtensionContext,
  WindowApi,
  WorkspaceApi,
  ViewsApi,
  ViewMessageHandler,
  ConfigurationChangeHandler,
  ShowModalOptions,
  ModalButton,
} from './extension-context.js'
export { createExtensionContext } from './extension-context.js'
export { createIpcTransport } from './ipc-adapter.js'
// createGrpcTransport is intentionally NOT exported here. It lives at the
// dedicated `@nodalcore/sdk/grpc` subpath so device-bridge plugins (which
// import the bare entry) don't drag @grpc/grpc-js + @grpc/proto-loader
// into their tsup `noExternal` bundle. See packages/sdk/src/grpc.ts.
export { coalesceLastWins } from './coalesce.js'
