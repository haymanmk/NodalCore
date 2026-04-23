/**
 * Plugin-host worker — runs in a child process (forked by loader.ts).
 * Receives the plugin entry path as argv[2], dynamic-imports it,
 * and dispatches method calls from the parent over Node IPC.
 */

const entryPath = process.argv[2]
if (!entryPath) {
  process.send?.({ seq: 0, ok: false, error: 'No entry path provided' })
  process.exit(1)
}

let plugin: Record<string, (...args: unknown[]) => unknown> | null = null

async function init() {
  const mod = await import(entryPath)
  const Ctor = mod.default ?? mod
  plugin = typeof Ctor === 'function' ? new Ctor() : Ctor
}

process.on(
  'message',
  async (msg: { seq: number; method: string; args: unknown }) => {
    const { seq, method, args } = msg

    try {
      if (method === 'init') {
        await init()
        process.send?.({ seq, ok: true, result: null })
        return
      }

      if (!plugin) {
        process.send?.({ seq, ok: false, error: 'Plugin not initialised' })
        return
      }

      const fn = plugin[method]
      if (typeof fn !== 'function') {
        process.send?.({ seq, ok: false, error: `Method not found: ${method}` })
        return
      }

      const result = await fn.call(plugin, args)
      process.send?.({ seq, ok: true, result })
    } catch (err) {
      process.send?.({ seq, ok: false, error: String(err) })
    }
  },
)
