export {
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
  getInstalledPlugin,
  readAndValidateManifest,
  reconcileRegistry,
  PLUGINS_DIR,
} from './installer.js'

export {
  loadDevicePlugin,
  unloadDevicePlugin,
  sendToPlugin,
  listLoadedPlugins,
} from './loader.js'

export { spawnTool, stopTool, getRunningTool, listRunningTools } from './spawner.js'

export {
  describeCurrentPlatform,
  selectArtifact,
  hashFile,
  downloadArtifact,
  verifyIntegrity,
  unpackArtifact,
  UnsupportedPlatformError,
  IntegrityError,
} from './artifact.js'
export type { PlatformDescriptor } from './artifact.js'

export {
  getConfiguration,
  setConfiguration,
  clearConfiguration,
  CONFIG_FILE,
} from './configuration.js'

export {
  registerHostHandler,
  dispatchHostRequest,
} from './broker.js'
export type { HostHandler } from './broker.js'

export {
  registerHostApiHandlers,
  setWindowMessageEmitter,
  setModalDispatcher,
} from './host-api/server.js'
export type {
  WindowMessageEmitter,
  WindowMessagePayload,
  ModalDispatcher,
} from './host-api/server.js'

export { startHostApiGrpcServer } from './host-api/grpc-server.js'
export type { HostApiGrpcServer } from './host-api/grpc-server.js'

export { listContributions } from './contributions.js'
export type {
  AggregatedContributions,
  AggregatedTheme,
  AggregatedSidebarSlot,
  AggregatedStatusBarSlot,
  AggregatedPanelWebview,
} from './contributions.js'
