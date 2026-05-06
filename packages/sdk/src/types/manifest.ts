import type { JSONSchema7 } from 'json-schema'
import type { Contributes } from './contributes.js'

export type ConnectionType = 'serial' | 'usb' | 'bluetooth' | 'tcp' | 'mqtt'

export type Permission = 'serial' | 'usb' | 'bluetooth' | 'network'

export type PluginType = 'device-bridge' | 'standalone-tool'

export interface PluginManifest {
  /** Unique plugin identifier, e.g. "com.example.my-sensor" */
  id: string
  name: string
  version: string
  /** Semver range of @nodalcore/sdk this plugin is compatible with */
  sdkVersion: string
  description: string
  /** URL or relative path to the plugin icon (SVG or PNG, min 64×64) */
  icon: string
  type: PluginType
  /**
   * Activation entry. For device-bridge plugins, the JS/TS module that exports
   * `activate(ctx)` (and optionally `deactivate()`). VSCode parity for `entry`.
   */
  main?: string
  /**
   * Deprecated alias for `main`. Removed in the manifest cutover commit.
   * @deprecated use `main`
   */
  entry?: string
  /**
   * For standalone-tool plugins: path to the executable (relative to plugin root).
   * The process receives connection info via environment variables.
   */
  executable?: string
  /** Path to the plugin's .proto file, relative to the plugin root. Optional. */
  protoFile?: string
  /**
   * Deprecated. Use `contributes.configuration` instead.
   * Removed in the manifest cutover commit.
   * @deprecated use `contributes.configuration`
   */
  settingsSchema?: JSONSchema7
  /** Required connection type. Drives ConnectionOptions and auto-populates permissions. */
  connectionType?: ConnectionType
  /**
   * Permissions requested by this plugin. Derived automatically from connectionType,
   * but can be overridden or extended here.
   */
  permissions: Permission[]
  /**
   * Optional SHA-256 checksum of the plugin archive, used for integrity verification
   * after download. Format: "sha256:<hex>".
   */
  integrity?: string
  /** Author information */
  author?: {
    name: string
    email?: string
    url?: string
  }
  /** Link to the plugin's source repository */
  repository?: string
  /** Homepage or documentation URL */
  homepage?: string
  tags?: string[]
  /**
   * Declarative contribution points consumed by the host: themes, configuration,
   * sidebar/statusBar slots, panel webview slots.
   */
  contributes?: Contributes
}
