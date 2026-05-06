export type { PluginManifest, PluginType, ConnectionType, Permission } from './types/manifest.js'

export { SDK_VERSION } from './version.js'

export { HOST_API_PROTO_TEXT } from './proto/host-api-text.js'

export type {
  Contributes,
  ThemeContribution,
  ConfigurationContribution,
  DeclarativeViewContribution,
  DeclarativeViewSlotType,
  StatusBarContribution,
  WebviewContribution,
  WebviewCsp,
} from './types/contributes.js'

export type {
  ConnectionOptions,
  SerialConnectionOptions,
  UsbConnectionOptions,
  BluetoothConnectionOptions,
  TcpConnectionOptions,
  MqttConnectionOptions,
  SettingsRecord,
} from './types/device-plugin.js'

export { DevicePlugin } from './types/device-plugin.js'

export type { StandaloneTool } from './types/standalone-tool.js'

export type {
  Transport,
  RequestHandler,
  ExtensionContext,
  WindowApi,
  WorkspaceApi,
  ViewsApi,
  ViewMessageHandler,
} from './host/index.js'

export {
  createIpcTransport,
  createGrpcTransport,
  createExtensionContext,
  coalesceLastWins,
} from './host/index.js'
