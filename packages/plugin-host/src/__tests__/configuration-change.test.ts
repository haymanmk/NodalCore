import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  setConfiguration,
  getConfiguration,
  setConfigurationChangeEmitter,
} from '../configuration.js'

let tempHome: string
let originalHome: string | undefined

beforeEach(() => {
  tempHome = mkdtempSync(path.join(tmpdir(), 'nodalcore-config-test-'))
  originalHome = process.env.HOME
  process.env.HOME = tempHome
})

afterEach(() => {
  setConfigurationChangeEmitter(null)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(tempHome, { recursive: true, force: true })
})

function nextTick(): Promise<void> {
  // setConfiguration fires the emitter via Promise.resolve().then(...) so the
  // emitter runs after the await of setConfiguration resolves. We need ONE
  // microtask flush to let the chained promise run.
  return new Promise((r) => setTimeout(r, 0))
}

describe('configuration change emitter', () => {
  it('fires after a successful setConfiguration with the merged config', async () => {
    const calls: Array<{ pluginId: string; cfg: Record<string, unknown> }> = []
    setConfigurationChangeEmitter((pluginId, cfg) => {
      calls.push({ pluginId, cfg })
    })

    await setConfiguration('plug-1', { unit: 'V' })
    await setConfiguration('plug-1', { sampleRate: 10 })
    await nextTick()

    expect(calls).toEqual([
      { pluginId: 'plug-1', cfg: { unit: 'V' } },
      { pluginId: 'plug-1', cfg: { unit: 'V', sampleRate: 10 } },
    ])
  })

  it('does not throw when no emitter is registered', async () => {
    setConfigurationChangeEmitter(null)
    await expect(setConfiguration('plug-2', { foo: 'bar' })).resolves.toBeUndefined()
    expect(await getConfiguration('plug-2')).toEqual({ foo: 'bar' })
  })

  it('survives a throwing emitter — the writer still resolves and the value is persisted', async () => {
    setConfigurationChangeEmitter(() => {
      throw new Error('boom')
    })

    await expect(setConfiguration('plug-3', { ok: true })).resolves.toBeUndefined()
    await nextTick()

    expect(await getConfiguration('plug-3')).toEqual({ ok: true })
  })

  it('passes only the changed plugin id, not unrelated ones', async () => {
    const seen: string[] = []
    setConfigurationChangeEmitter((pluginId) => {
      seen.push(pluginId)
    })

    await setConfiguration('plug-a', { x: 1 })
    await setConfiguration('plug-b', { y: 2 })
    await setConfiguration('plug-a', { x: 3 })
    await nextTick()

    expect(seen).toEqual(['plug-a', 'plug-b', 'plug-a'])
  })
})
