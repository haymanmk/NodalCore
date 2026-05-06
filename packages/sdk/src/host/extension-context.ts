import type { Transport, RequestHandler } from './transport.js'

export interface WindowApi {
  /** Show a message to the user (toast in the desktop app, log in headless contexts). */
  showMessage(message: string, level?: 'info' | 'warning' | 'error'): Promise<void>
}

export interface WorkspaceApi {
  /** Read this plugin's persisted configuration from the host configuration store. */
  getConfiguration(): Promise<Record<string, unknown>>
  /** Merge values into this plugin's persisted configuration. */
  setConfiguration(values: Record<string, unknown>): Promise<void>
}

export type ViewMessageHandler = (data: unknown) => unknown | Promise<unknown>

export interface ViewsApi {
  /**
   * Push a message to the panel webview at `slotId`. The webview receives it
   * via `window.nodalcore.onMessage(handler)`. Returns whatever the webview's
   * handler returned (or null if the webview isn't currently mounted).
   */
  postMessage(slotId: string, data: unknown): Promise<unknown>
  /**
   * Register a handler for messages the panel webview pushes from
   * `window.nodalcore.postMessage(data)`. Each `slotId` has at most one
   * handler — registering again replaces it.
   */
  onMessage(slotId: string, handler: ViewMessageHandler): void
}

export interface ExtensionContext {
  pluginId: string
  window: WindowApi
  workspace: WorkspaceApi
  views: ViewsApi
}

export function createExtensionContext(
  transport: Transport,
  pluginId: string,
): ExtensionContext {
  const viewHandlers = new Map<string, ViewMessageHandler>()

  // Inbound: host pushes a message that originated from a webview.
  // Envelope: { slotId, data }. Returns whatever the registered handler returns.
  const inbound: RequestHandler = async (args) => {
    const { slotId, data } = (args as { slotId: string; data: unknown } | undefined) ?? {
      slotId: '',
      data: null,
    }
    const handler = viewHandlers.get(slotId)
    if (!handler) return null
    return handler(data)
  }
  transport.onRequest('views.message', inbound)

  return {
    pluginId,
    window: {
      async showMessage(message, level) {
        await transport.request('window.showMessage', { message, level })
      },
    },
    workspace: {
      async getConfiguration() {
        return (await transport.request('workspace.getConfiguration', {})) as Record<string, unknown>
      },
      async setConfiguration(values) {
        await transport.request('workspace.setConfiguration', values)
      },
    },
    views: {
      async postMessage(slotId, data) {
        return transport.request('views.postMessage', { slotId, data })
      },
      onMessage(slotId, handler) {
        viewHandlers.set(slotId, handler)
      },
    },
  }
}
