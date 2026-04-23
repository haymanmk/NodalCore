import type { ConnectionOptions } from '@nodalcore/sdk'
import type { JSONSchema7 } from 'json-schema'
import { DevicePlugin } from '@nodalcore/sdk'

interface MultimeterSettings {
  unit: string
  autoRange: boolean
  sampleRate: number
}

export default class MultimeterPlugin extends DevicePlugin {
  readonly connectionType = 'serial' as const

  private connected = false
  private settings: MultimeterSettings = {
    unit: 'V',
    autoRange: true,
    sampleRate: 10,
  }

  async connect(options: ConnectionOptions): Promise<void> {
    console.log(`[MultimeterPlugin] Connecting via serial...`, options)
    // In a real plugin this would open a serial port
    this.connected = true
    console.log('[MultimeterPlugin] Connected.')
  }

  async disconnect(): Promise<void> {
    console.log('[MultimeterPlugin] Disconnecting...')
    this.connected = false
  }

  getSettingsSchema(): JSONSchema7 {
    return {
      type: 'object',
      properties: {
        unit: {
          type: 'string',
          title: 'Measurement Unit',
          enum: ['V', 'mV', 'A', 'mA', 'Ω', 'kΩ'],
          default: 'V',
        },
        autoRange: {
          type: 'boolean',
          title: 'Auto Range',
          default: true,
        },
        sampleRate: {
          type: 'number',
          title: 'Sample Rate (Hz)',
          minimum: 1,
          maximum: 1000,
          default: 10,
        },
      },
      required: ['unit', 'autoRange', 'sampleRate'],
    }
  }

  async readSettings(): Promise<Record<string, unknown>> {
    return { ...this.settings }
  }

  async writeSettings(values: Record<string, unknown>): Promise<void> {
    if (values.unit !== undefined) this.settings.unit = String(values.unit)
    if (values.autoRange !== undefined) this.settings.autoRange = Boolean(values.autoRange)
    if (values.sampleRate !== undefined) this.settings.sampleRate = Number(values.sampleRate)
    console.log('[MultimeterPlugin] Settings updated:', this.settings)
  }
}
