import type { JSONSchema7 } from 'json-schema'
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
 * @example
 * ```ts
 * import { DevicePlugin, SerialConnectionOptions, SettingsRecord } from '@nodalcore/sdk'
 *
 * export default class MyDevice extends DevicePlugin {
 *   async connect(options: SerialConnectionOptions) { ... }
 *   async disconnect() { ... }
 *   getSettingsSchema() { return { ... } }
 *   async readSettings() { return { ... } }
 *   async writeSettings(settings) { ... }
 * }
 * ```
 */
export abstract class DevicePlugin {
  abstract readonly connectionType: ConnectionType

  /** Open the physical connection to the device. */
  abstract connect(options: ConnectionOptions): Promise<void>

  /** Close the connection and release all resources. */
  abstract disconnect(): Promise<void>

  /**
   * Return the JSON Schema 7 that describes the device's settings.
   * This is also declared in nodal.json, but the runtime value here
   * takes precedence (allows dynamic schema based on detected firmware).
   */
  abstract getSettingsSchema(): JSONSchema7

  /** Read the current settings from the device. */
  abstract readSettings(): Promise<SettingsRecord>

  /**
   * Write partial settings to the device.
   * Implementations must validate values against the schema before writing.
   */
  abstract writeSettings(settings: Partial<SettingsRecord>): Promise<void>
}
