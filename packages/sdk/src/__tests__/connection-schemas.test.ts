import { describe, it, expect } from 'vitest'
import { connectionSchemas } from '../schemas/connection.js'
import type { ConnectionType } from '../types/manifest.js'

const ALL_TYPES: ConnectionType[] = ['serial', 'usb', 'bluetooth', 'tcp', 'mqtt']

describe('connectionSchemas', () => {
  for (const type of ALL_TYPES) {
    describe(type, () => {
      it('exists in the schema map', () => {
        expect(connectionSchemas[type]).toBeDefined()
      })

      it('declares connectionType as a const matching the map key', () => {
        const schema = connectionSchemas[type]
        const props = (schema.properties ?? {}) as Record<string, { const?: string }>
        expect(props.connectionType?.const).toBe(type)
      })

      it('every required field is declared in properties', () => {
        const schema = connectionSchemas[type]
        const required = schema.required ?? []
        const props = schema.properties ?? {}
        for (const field of required) {
          expect(props).toHaveProperty(field)
        }
      })

      it('is type: object', () => {
        expect(connectionSchemas[type].type).toBe('object')
      })
    })
  }
})

describe('connectionSchemas — TCP shape (sanity)', () => {
  it('requires host and port', () => {
    expect(connectionSchemas.tcp.required).toContain('host')
    expect(connectionSchemas.tcp.required).toContain('port')
  })

  it('defaults host to 127.0.0.1 and port to 5025', () => {
    const props = connectionSchemas.tcp.properties as Record<string, { default?: unknown }>
    expect(props.host?.default).toBe('127.0.0.1')
    expect(props.port?.default).toBe(5025)
  })
})
