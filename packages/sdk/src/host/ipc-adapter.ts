import type { Transport, RequestHandler } from './transport.js'

interface IpcMessage {
  kind: 'request' | 'response'
  seq: number
  method?: string
  args?: unknown
  result?: unknown
  error?: string
}

interface NodeIpcProcess {
  send?: (msg: IpcMessage) => boolean
  on: (event: 'message', listener: (msg: unknown) => void) => unknown
}

/**
 * Create a Transport over a forked Node child's IPC channel. Both ends use the
 * same wire format `{ kind: 'request' | 'response', seq, method?, args?, result?, error? }`,
 * with separate seq spaces in each direction so concurrent in/out requests cannot collide.
 */
export function createIpcTransport(): Transport {
  const proc = (globalThis as { process?: NodeIpcProcess }).process
  if (!proc || typeof proc.send !== 'function') {
    throw new Error('IPC transport requires a forked process with an IPC channel')
  }
  const send = proc.send.bind(proc) as (msg: IpcMessage) => boolean

  let nextSeq = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const handlers = new Map<string, RequestHandler>()

  proc.on('message', async (raw: unknown) => {
    const msg = raw as IpcMessage
    if (!msg || (msg.kind !== 'request' && msg.kind !== 'response')) return

    if (msg.kind === 'response') {
      const p = pending.get(msg.seq)
      if (!p) return
      pending.delete(msg.seq)
      if (msg.error !== undefined) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
      return
    }

    if (msg.method === undefined) return
    const handler = handlers.get(msg.method)
    try {
      if (!handler) throw new Error(`No handler for method ${msg.method}`)
      const result = await handler(msg.args)
      send({ kind: 'response', seq: msg.seq, result })
    } catch (err) {
      send({ kind: 'response', seq: msg.seq, error: err instanceof Error ? err.message : String(err) })
    }
  })

  return {
    request(method, args) {
      return new Promise((resolve, reject) => {
        const seq = nextSeq++
        pending.set(seq, { resolve, reject })
        send({ kind: 'request', seq, method, args })
      })
    },
    onRequest(method, handler) {
      handlers.set(method, handler)
    },
  }
}
