export {
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
  getInstalledPlugin,
  readAndValidateManifest,
  reconcileRegistry,
  PLUGINS_DIR,
} from './installer.js'

export { loadDevicePlugin, unloadDevicePlugin } from './loader.js'

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
