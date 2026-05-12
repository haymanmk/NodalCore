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
  setFetcher,
  UnsupportedPlatformError,
  IntegrityError,
} from './artifact.js'
export type { PlatformDescriptor, Fetcher } from './artifact.js'

export {
  getConfiguration,
  setConfiguration,
  clearConfiguration,
  setConfigurationChangeEmitter,
} from './configuration.js'
export type { ConfigurationChangeEmitter } from './configuration.js'

export {
  AUTO_START_KEY,
  shouldAutoStart,
  autoStartInstalledPlugins,
} from './auto-start.js'
export type {
  AutoStartContext,
  AutoStartDeps,
  AutoStartLevel,
} from './auto-start.js'

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

export {
  getConnectionOptions,
  setConnectionOptions,
  clearConnectionOptions,
} from './connection-store.js'
export type {
  AggregatedContributions,
  AggregatedTheme,
  AggregatedSidebarSlot,
  AggregatedStatusBarSlot,
  AggregatedPanelWebview,
} from './contributions.js'
