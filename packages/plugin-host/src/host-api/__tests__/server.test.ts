import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dispatchHostRequest } from '../../broker.js'
import {
  registerHostApiHandlers,
  setModalDispatcher,
} from '../server.js'
import type { ShowModalOptions } from '@nodalcore/sdk'

describe('host-api server — modal handlers', () => {
  beforeEach(() => {
    registerHostApiHandlers()
  })

  it('routes window.showWarning to the dispatcher with pluginId', async () => {
    const showWarning = vi.fn(async () => undefined)
    setModalDispatcher({
      showWarning,
      showModal: async () => 'ok',
    })
    await dispatchHostRequest('plug-1', 'window.showWarning', { message: 'hi', detail: 'd' })
    expect(showWarning).toHaveBeenCalledWith('plug-1', 'hi', 'd')
  })

  it('routes window.showModal to the dispatcher and returns its result', async () => {
    const showModal = vi.fn(async (_pluginId: string, opts: ShowModalOptions) => {
      expect(opts.message).toBe('Pick one')
      return 'discard'
    })
    setModalDispatcher({
      showWarning: async () => undefined,
      showModal,
    })
    const result = await dispatchHostRequest('plug-1', 'window.showModal', {
      message: 'Pick one',
      buttons: [{ id: 'discard', label: 'Discard' }, { id: 'keep', label: 'Keep' }],
    })
    expect(result).toBe('discard')
    expect(showModal).toHaveBeenCalledWith('plug-1', expect.objectContaining({ message: 'Pick one' }))
  })
})

describe('host-api server — default no-op modal dispatcher behavior', () => {
  beforeEach(() => {
    registerHostApiHandlers()
    setModalDispatcher({
      showWarning: async () => undefined,
      showModal: async (_id, opts) => {
        const buttons = opts.buttons?.length ? opts.buttons : [{ id: 'ok', label: 'OK' }]
        return (buttons.find((b) => b.cancel) ?? buttons[0]!).id
      },
    })
  })

  it('default showModal returns "ok" when buttons is empty', async () => {
    const result = await dispatchHostRequest('plug-1', 'window.showModal', { message: 'go?' })
    expect(result).toBe('ok')
  })

  it('default showModal returns the cancel button id when present', async () => {
    const result = await dispatchHostRequest('plug-1', 'window.showModal', {
      message: 'pick',
      buttons: [
        { id: 'go', label: 'Go', default: true },
        { id: 'no', label: 'No', cancel: true },
      ],
    })
    expect(result).toBe('no')
  })
})
