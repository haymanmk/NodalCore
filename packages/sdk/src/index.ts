export type { PluginManifest, PluginType, ConnectionType, Permission } from './types/manifest.js'

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
