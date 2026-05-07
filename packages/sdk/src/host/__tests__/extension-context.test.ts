import { describe, it, expect, vi } from 'vitest'
import { createExtensionContext } from '../extension-context.js'
import type { Transport } from '../transport.js'

function makeTransport(): { transport: Transport; calls: Array<{ method: string; args: unknown }> } {
  const calls: Array<{ method: string; args: unknown }> = []
  const transport: Transport = {
    request: vi.fn(async (method, args) => {
      calls.push({ method, args })
      if (method === 'window.showModal') return 0
      return undefined
    }),
    onRequest: vi.fn(),
  }
  return { transport, calls }
}

describe('createExtensionContext — window.showWarning', () => {
  it('forwards message and detail to the transport', async () => {
    const { transport, calls } = makeTransport()
    const ctx = createExtensionContext(transport, 'plug-1')
    await ctx.window.showWarning('hi', 'details')
    expect(calls).toEqual([{ method: 'window.showWarning', args: { message: 'hi', detail: 'details' } }])
  })

  it('omits detail when not provided', async () => {
    const { transport, calls } = makeTransport()
    const ctx = createExtensionContext(transport, 'plug-1')
    await ctx.window.showWarning('hi')
    expect(calls).toEqual([{ method: 'window.showWarning', args: { message: 'hi', detail: undefined } }])
  })
})

describe('createExtensionContext — window.showModal', () => {
  it('forwards options and resolves with the host-returned button id', async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const transport: Transport = {
      request: vi.fn(async (method, args) => {
        calls.push({ method, args })
        return 'discard'
      }),
      onRequest: vi.fn(),
    }
    const ctx = createExtensionContext(transport, 'plug-1')
    const result = await ctx.window.showModal({
      type: 'question',
      message: 'Discard?',
      buttons: [
        { id: 'discard', label: 'Discard', default: true },
        { id: 'keep', label: 'Keep', cancel: true },
      ],
    })
    expect(result).toBe('discard')
    expect(calls[0]?.method).toBe('window.showModal')
  })
})
