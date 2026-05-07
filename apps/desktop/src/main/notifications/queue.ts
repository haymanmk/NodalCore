export interface QueuedToast {
  pluginId: string
  message: string
  level: 'info' | 'warning' | 'error'
  ts: number
}

const queue: QueuedToast[] = []
const MAX = 200
const listeners = new Set<() => void>()

export function enqueue(t: QueuedToast): void {
  queue.push(t)
  if (queue.length > MAX) queue.splice(0, queue.length - MAX)
  for (const l of listeners) l()
}

export function drain(): QueuedToast[] {
  const out = queue.splice(0, queue.length)
  for (const l of listeners) l()
  return out
}

export function getQueueLength(): number {
  return queue.length
}

export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
