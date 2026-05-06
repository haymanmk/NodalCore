import type { ConnectionType } from './manifest.js'

// ---------------------------------------------------------------------------
// ConnectionOptions — discriminated union keyed on connectionType
// ---------------------------------------------------------------------------

export interface SerialConnectionOptions {
  connectionType: 'serial'
  port: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 2
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
}

export interface UsbConnectionOptions {
  connectionType: 'usb'
  vendorId: number
  productId: number
}

export interface BluetoothConnectionOptions {
  connectionType: 'bluetooth'
  serviceUUID: string
  characteristicUUID?: string
}

export interface TcpConnectionOptions {
  connectionType: 'tcp'
  host: string
  port: number
}

export interface MqttConnectionOptions {
  connectionType: 'mqtt'
  brokerUrl: string
  topic: string
  username?: string
  password?: string
}

export type ConnectionOptions =
  | SerialConnectionOptions
  | UsbConnectionOptions
  | BluetoothConnectionOptions
  | TcpConnectionOptions
  | MqttConnectionOptions

// ---------------------------------------------------------------------------
// Settings types
// ---------------------------------------------------------------------------

/** A flat record of setting key → value. Values are JSON-compatible. */
export type SettingsRecord = Record<string, unknown>

// ---------------------------------------------------------------------------
// DevicePlugin — abstract base class for device-bridge plugins
// ---------------------------------------------------------------------------

/**
 * Abstract base class that every device-bridge plugin must extend.
 *
 * Settings have moved out of the plugin: use `host.workspace.getConfiguration()`
 * from the activate(ctx) entry point if you need to read user-configured values.
 *
 * @example
 * ```ts
 * import { DevicePlugin, type ExtensionContext } from '@nodalcore/sdk'
 *
 * export default class MyDevice extends DevicePlugin {
 *   readonly connectionType = 'serial' as const
 *   async connect(options) { ... }
 *   async disconnect() { ... }
 * }
 *
 * export async function activate(ctx: ExtensionContext) {
 *   await ctx.window.showMessage('Plugin activated')
 * }
 * ```
 */
export abstract class DevicePlugin {
  abstract readonly connectionType: ConnectionType

  /** Open the physical connection to the device. */
  abstract connect(options: ConnectionOptions): Promise<void>

  /** Close the connection and release all resources. */
  abstract disconnect(): Promise<void>
}
