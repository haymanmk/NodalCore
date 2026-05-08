import type { Transport, RequestHandler } from './transport.js'

export interface WindowApi {
  /** Show a message to the user (toast in the desktop app, log in headless contexts). */
  showMessage(message: string, level?: 'info' | 'warning' | 'error'): Promise<void>
  /**
   * Passive native dialog with a single OK button. Use for "you should look
   * at this" events that are louder than a toast but don't require a
   * decision from the user.
   */
  showWarning(message: string, detail?: string): Promise<void>
  /**
   * Interactive native dialog. Resolves with the id of the button the user
   * clicked, or with the cancel button's id if the user dismissed via Esc /
   * the dialog's close button. If no button has `cancel: true` and the user
   * dismisses, resolves with the id of the first button.
   */
  showModal(options: ShowModalOptions): Promise<string>
}

export interface ShowModalOptions {
  /** Primary headline — short, one line. */
  message: string
  /** Optional second-line body. */
  detail?: string
  /** Native dialog icon. Defaults to 'info'. */
  type?: 'info' | 'warning' | 'error' | 'question'
  /** Buttons, left-to-right. Defaults to a single 'OK' button if omitted or empty. */
  buttons?: ModalButton[]
}

export interface ModalButton {
  /** Stable identifier returned from `showModal`. Never shown to the user. */
  id: string
  /** User-visible button label. */
  label: string
  /** Highlighted as the default action (Enter key). At most one. */
  default?: boolean
  /**
   * Returned when the user presses Esc or closes the dialog.
   * If no button has `cancel: true` and the user dismisses, the promise
   * resolves with the id of the first button.
   */
  cancel?: boolean
}

export type ConfigurationChangeHandler = (
  newConfig: Record<string, unknown>,
) => void | Promise<void>

export interface WorkspaceApi {
  /** Read this plugin's persisted configuration from the host configuration store. */
  getConfiguration(): Promise<Record<string, unknown>>
  /** Merge values into this plugin's persisted configuration. */
  setConfiguration(values: Record<string, unknown>): Promise<void>
  /**
   * Subscribe to configuration changes pushed from the host. The handler
   * receives the FULL post-merge configuration (not a delta) every time
   * `setConfiguration` runs against this plugin id from any source — UI,
   * CLI, MCP, or the plugin itself.
   *
   * Only the most recently registered handler is active; calling this again
   * replaces the previous handler. To stop subscribing, pass `null`.
   *
   * Handlers should treat their own `setConfiguration` calls as potentially
   * echoing back, and avoid unconditional re-writes from inside the handler.
   */
  onDidChangeConfiguration(handler: ConfigurationChangeHandler | null): void
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

  // Inbound: host pushes the new configuration after setConfiguration runs.
  let configChangeHandler: ConfigurationChangeHandler | null = null
  transport.onRequest('workspace.configurationChanged', async (args) => {
    if (!configChangeHandler) return null
    const newConfig = (args as Record<string, unknown> | undefined) ?? {}
    await configChangeHandler(newConfig)
    return null
  })

  return {
    pluginId,
    window: {
      async showMessage(message, level) {
        await transport.request('window.showMessage', { message, level })
      },
      async showWarning(message, detail) {
        await transport.request('window.showWarning', { message, detail })
      },
      async showModal(options) {
        const result = await transport.request('window.showModal', options)
        return result as string
      },
    },
    workspace: {
      async getConfiguration() {
        return (await transport.request('workspace.getConfiguration', {})) as Record<string, unknown>
      },
      async setConfiguration(values) {
        await transport.request('workspace.setConfiguration', values)
      },
      onDidChangeConfiguration(handler) {
        configChangeHandler = handler
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
