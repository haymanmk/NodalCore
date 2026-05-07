import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  getConnectionOptions,
  setConnectionOptions,
  clearConnectionOptions,
} from '../connection-store.js'
import type { TcpConnectionOptions } from '@nodalcore/sdk'

let tempHome: string
let originalHome: string | undefined

beforeEach(() => {
  tempHome = mkdtempSync(path.join(tmpdir(), 'nodalcore-conn-test-'))
  originalHome = process.env.HOME
  process.env.HOME = tempHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(tempHome, { recursive: true, force: true })
})

const tcp: TcpConnectionOptions = {
  connectionType: 'tcp',
  host: '192.168.1.50',
  port: 5025,
}

describe('connection-store', () => {
  it('set then get round-trips a TcpConnectionOptions', async () => {
    await setConnectionOptions('plug-1', tcp)
    const got = await getConnectionOptions('plug-1', 'tcp')
    expect(got).toEqual(tcp)
  })

  it('get for an unknown pluginId returns null', async () => {
    const got = await getConnectionOptions('does-not-exist', 'tcp')
    expect(got).toBeNull()
  })

  it('get with a mismatched expectedType returns null (manifest-changed guard)', async () => {
    await setConnectionOptions('plug-1', tcp)
    const got = await getConnectionOptions('plug-1', 'serial')
    expect(got).toBeNull()
  })

  it('clear removes the entry', async () => {
    await setConnectionOptions('plug-1', tcp)
    await clearConnectionOptions('plug-1')
    const got = await getConnectionOptions('plug-1', 'tcp')
    expect(got).toBeNull()
  })

  it('set is per-plugin — does not affect other entries', async () => {
    await setConnectionOptions('plug-1', tcp)
    await setConnectionOptions('plug-2', { ...tcp, host: '10.0.0.1' })
    expect(await getConnectionOptions('plug-1', 'tcp')).toEqual(tcp)
    expect(await getConnectionOptions('plug-2', 'tcp')).toEqual({ ...tcp, host: '10.0.0.1' })
  })

  it('returns null when the file is missing', async () => {
    const got = await getConnectionOptions('plug-1', 'tcp')
    expect(got).toBeNull()
  })

  it('returns null when the file is corrupted', async () => {
    mkdirSync(path.join(tempHome, '.nodalcore'), { recursive: true })
    writeFileSync(path.join(tempHome, '.nodalcore', 'connections.json'), 'not json{', 'utf8')
    const got = await getConnectionOptions('plug-1', 'tcp')
    expect(got).toBeNull()
  })
})
