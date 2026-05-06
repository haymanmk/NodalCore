/**
 * Single-source-of-truth router for plugin → host calls. Loaders/spawners
 * funnel inbound requests through `dispatchHostRequest`; host modules
 * (host-api/server.ts, future webviews/manager.ts) register their handlers
 * via `registerHostHandler`. This avoids smearing routing across loader.ts,
 * worker.ts, and any future transports.
 */

export type HostHandler = (pluginId: string, args: unknown) => unknown | Promise<unknown>

const handlers = new Map<string, HostHandler>()

export function registerHostHandler(method: string, handler: HostHandler): void {
  handlers.set(method, handler)
}

export async function dispatchHostRequest(
  pluginId: string,
  method: string,
  args: unknown,
): Promise<unknown> {
  const handler = handlers.get(method)
  if (!handler) throw new Error(`Unknown host method: ${method}`)
  return handler(pluginId, args)
}
