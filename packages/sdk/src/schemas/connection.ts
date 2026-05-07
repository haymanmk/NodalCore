import type { JSONSchema7 } from 'json-schema'
import type { ConnectionType } from '../types/manifest.js'

export const connectionSchemas: Record<ConnectionType, JSONSchema7> = {
  serial: {
    type: 'object',
    required: ['port', 'baudRate'],
    properties: {
      connectionType: { type: 'string', const: 'serial' },
      port: {
        type: 'string',
        title: 'Port',
        description: 'e.g. /dev/ttyUSB0 or COM3',
        default: '',
      },
      baudRate: {
        type: 'integer',
        title: 'Baud rate',
        enum: [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600],
        default: 115200,
      },
      dataBits: { type: 'integer', title: 'Data bits', enum: [5, 6, 7, 8], default: 8 },
      stopBits: { type: 'integer', title: 'Stop bits', enum: [1, 2], default: 1 },
      parity: {
        type: 'string',
        title: 'Parity',
        enum: ['none', 'even', 'odd', 'mark', 'space'],
        default: 'none',
      },
    },
  },

  usb: {
    type: 'object',
    required: ['vendorId', 'productId'],
    properties: {
      connectionType: { type: 'string', const: 'usb' },
      vendorId: {
        type: 'integer',
        title: 'Vendor ID',
        description: '0x… (decimal accepted)',
        minimum: 0,
        maximum: 0xFFFF,
        default: 0,
      },
      productId: {
        type: 'integer',
        title: 'Product ID',
        minimum: 0,
        maximum: 0xFFFF,
        default: 0,
      },
    },
  },

  bluetooth: {
    type: 'object',
    required: ['serviceUUID'],
    properties: {
      connectionType: { type: 'string', const: 'bluetooth' },
      serviceUUID: {
        type: 'string',
        title: 'Service UUID',
        description: 'e.g. 0000180f-0000-1000-8000-00805f9b34fb',
        default: '',
      },
      characteristicUUID: {
        type: 'string',
        title: 'Characteristic UUID (optional)',
        default: '',
      },
    },
  },

  tcp: {
    type: 'object',
    required: ['host', 'port'],
    properties: {
      connectionType: { type: 'string', const: 'tcp' },
      host: {
        type: 'string',
        title: 'Host',
        description: 'IP address or hostname',
        default: '127.0.0.1',
      },
      port: {
        type: 'integer',
        title: 'Port',
        minimum: 1,
        maximum: 65535,
        default: 5025,
      },
    },
  },

  mqtt: {
    type: 'object',
    required: ['brokerUrl', 'topic'],
    properties: {
      connectionType: { type: 'string', const: 'mqtt' },
      brokerUrl: {
        type: 'string',
        title: 'Broker URL',
        description: 'e.g. mqtts://broker.example.com:8883',
        default: '',
      },
      topic: { type: 'string', title: 'Topic', default: '' },
      username: { type: 'string', title: 'Username (optional)', default: '' },
      password: {
        type: 'string',
        title: 'Password (optional)',
        format: 'password',
        default: '',
      },
    },
  },
}
