import type { Transport } from './transport.js'

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

export interface ExtensionContext {
  pluginId: string
  window: WindowApi
  workspace: WorkspaceApi
}

export function createExtensionContext(
  transport: Transport,
  pluginId: string,
): ExtensionContext {
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
  }
}
