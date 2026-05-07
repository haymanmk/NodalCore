import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  enqueue,
  drain,
  getQueueLength,
  onQueueChange,
  type QueuedToast,
} from '../notifications/queue.js'

function toast(overrides: Partial<QueuedToast> = {}): QueuedToast {
  return {
    pluginId: 'plug-1',
    message: 'm',
    level: 'info',
    ts: 0,
    ...overrides,
  }
}

describe('notifications/queue', () => {
  beforeEach(() => {
    drain()
  })

  it('enqueue + drain returns FIFO order', () => {
    enqueue(toast({ message: 'a' }))
    enqueue(toast({ message: 'b' }))
    enqueue(toast({ message: 'c' }))
    const out = drain()
    expect(out.map((t) => t.message)).toEqual(['a', 'b', 'c'])
  })

  it('drain empties the queue', () => {
    enqueue(toast())
    drain()
    expect(getQueueLength()).toBe(0)
  })

  it('caps at 200 entries by dropping oldest', () => {
    for (let i = 0; i < 250; i++) enqueue(toast({ message: `m${i}` }))
    expect(getQueueLength()).toBe(200)
    const out = drain()
    expect(out[0]?.message).toBe('m50')
    expect(out[out.length - 1]?.message).toBe('m249')
  })

  it('notifies listeners on enqueue and drain', () => {
    const listener = vi.fn()
    const off = onQueueChange(listener)
    enqueue(toast())
    expect(listener).toHaveBeenCalledTimes(1)
    drain()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    enqueue(toast())
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('getQueueLength reports current size', () => {
    enqueue(toast())
    enqueue(toast())
    expect(getQueueLength()).toBe(2)
  })
})
