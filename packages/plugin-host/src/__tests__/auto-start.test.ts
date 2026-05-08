import { describe, it, expect } from 'vitest'
import type { PluginManifest } from '@nodalcore/sdk'
import {
  AUTO_START_KEY,
  shouldAutoStart,
  autoStartInstalledPlugins,
  type AutoStartDeps,
} from '../auto-start.js'

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'plug',
    name: 'Plug',
    version: '0.1.0',
    sdkVersion: '>=0.4.0',
    description: 'test',
    icon: 'icon.png',
    type: 'device-bridge',
    main: 'dist/index.js',
    permissions: [],
    ...overrides,
  }
}

function withDeclaredAutoStart(defaultValue: boolean): PluginManifest {
  return manifest({
    contributes: {
      configuration: {
        properties: {
          [AUTO_START_KEY]: { type: 'boolean', default: defaultValue },
        },
      },
    },
  })
}

describe('shouldAutoStart precedence', () => {
  it('returns false when neither stored nor manifest declared', () => {
    expect(shouldAutoStart(manifest(), null)).toBe(false)
    expect(shouldAutoStart(manifest(), {})).toBe(false)
    expect(shouldAutoStart(manifest(), undefined)).toBe(false)
  })

  it('honours manifest default when nothing stored', () => {
    expect(shouldAutoStart(withDeclaredAutoStart(true), null)).toBe(true)
    expect(shouldAutoStart(withDeclaredAutoStart(false), {})).toBe(false)
  })

  it('stored value overrides manifest default', () => {
    expect(shouldAutoStart(withDeclaredAutoStart(true), { autoStart: false })).toBe(false)
    expect(shouldAutoStart(withDeclaredAutoStart(false), { autoStart: true })).toBe(true)
  })

  it('non-boolean stored value falls through to manifest default', () => {
    // Bad data in the store (e.g. user hand-edited) shouldn't crash; we
    // treat anything non-boolean as "not set" and fall through.
    expect(shouldAutoStart(withDeclaredAutoStart(true), { autoStart: 'yes' })).toBe(true)
    expect(shouldAutoStart(manifest(), { autoStart: 1 })).toBe(false)
  })
})

describe('autoStartInstalledPlugins', () => {
  function makeDeps(overrides: Partial<AutoStartDeps>): AutoStartDeps {
    return {
      listInstalledPlugins: async () => [],
      getConfiguration: async () => ({}),
      getConnectionOptions: async () => null,
      loadDevicePlugin: async () => {
        throw new Error('loadDevicePlugin should not be called')
      },
      spawnTool: async () => {
        throw new Error('spawnTool should not be called')
      },
      ...overrides,
    }
  }

  it('skips plugins whose effective autoStart is false', async () => {
    const events: Array<[string, string]> = []
    await autoStartInstalledPlugins(
      { emit: (l, m) => events.push([l, m]) },
      makeDeps({
        listInstalledPlugins: async () => [
          { manifest: manifest(), installedAt: '', status: 'idle' as const },
        ],
      }),
    )
    expect(events).toEqual([])
  })

  it('warns when a device-bridge has autoStart but no saved connection', async () => {
    const events: Array<[string, string]> = []
    await autoStartInstalledPlugins(
      { emit: (l, m) => events.push([l, m]) },
      makeDeps({
        listInstalledPlugins: async () => [
          {
            manifest: manifest({ connectionType: 'serial' }),
            installedAt: '',
            status: 'idle' as const,
          },
        ],
        getConfiguration: async () => ({ autoStart: true }),
        getConnectionOptions: async () => null,
      }),
    )
    expect(events).toHaveLength(1)
    expect(events[0]![0]).toBe('warning')
    expect(events[0]![1]).toMatch(/connect once/i)
  })

  it('loads + connects a device-bridge with stored connection options', async () => {
    let connectedWith: unknown = null
    const events: Array<[string, string]> = []
    await autoStartInstalledPlugins(
      { emit: (l, m) => events.push([l, m]) },
      makeDeps({
        listInstalledPlugins: async () => [
          {
            manifest: manifest({ connectionType: 'serial' }),
            installedAt: '',
            status: 'idle' as const,
          },
        ],
        getConfiguration: async () => ({ autoStart: true }),
        getConnectionOptions: async () =>
          ({ connectionType: 'serial', port: '/dev/ttyUSB0', baudRate: 9600 }) as never,
        loadDevicePlugin: async () =>
          ({
            connectionType: 'serial',
            connect: async (opts: unknown) => { connectedWith = opts },
            disconnect: async () => {},
          }) as never,
      }),
    )
    expect(connectedWith).toEqual({ connectionType: 'serial', port: '/dev/ttyUSB0', baudRate: 9600 })
    expect(events.find(([l]) => l === 'info')).toBeTruthy()
  })

  it('spawns a standalone-tool', async () => {
    let spawned = false
    await autoStartInstalledPlugins(
      { emit: () => {} },
      makeDeps({
        listInstalledPlugins: async () => [
          {
            manifest: manifest({ type: 'standalone-tool', main: undefined, executable: 'bin/tool' }),
            installedAt: '',
            status: 'idle' as const,
          },
        ],
        getConfiguration: async () => ({ autoStart: true }),
        spawnTool: async () => { spawned = true; return { port: 0 } as never },
      }),
    )
    expect(spawned).toBe(true)
  })

  it('contains per-plugin failures and continues with the rest', async () => {
    const events: Array<[string, string]> = []
    let goodSpawned = false
    await autoStartInstalledPlugins(
      { emit: (l, m) => events.push([l, m]) },
      makeDeps({
        listInstalledPlugins: async () => [
          {
            manifest: manifest({ id: 'bad', name: 'Bad Plugin', type: 'standalone-tool', executable: 'bin/x' }),
            installedAt: '',
            status: 'idle' as const,
          },
          {
            manifest: manifest({ id: 'good', name: 'Good Plugin', type: 'standalone-tool', executable: 'bin/y' }),
            installedAt: '',
            status: 'idle' as const,
          },
        ],
        getConfiguration: async () => ({ autoStart: true }),
        spawnTool: async (id: string) => {
          if (id === 'bad') throw new Error('exec not found')
          goodSpawned = true
          return { port: 0 } as never
        },
      }),
    )
    expect(goodSpawned).toBe(true)
    expect(events.find(([l, m]) => l === 'error' && m.includes('Bad Plugin'))).toBeTruthy()
    expect(events.find(([l, m]) => l === 'info' && m.includes('Good Plugin'))).toBeTruthy()
  })
})
