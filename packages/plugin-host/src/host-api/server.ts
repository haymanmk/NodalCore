import type { ShowModalOptions } from '@nodalcore/sdk'
import { registerHostHandler } from '../broker.js'
import { getConfiguration, setConfiguration } from '../configuration.js'

export interface WindowMessagePayload {
  message: string
  level?: 'info' | 'warning' | 'error'
}

export type WindowMessageEmitter = (pluginId: string, payload: WindowMessagePayload) => void

export interface ModalDispatcher {
  showWarning(pluginId: string, message: string, detail?: string): Promise<void>
  showModal(pluginId: string, options: ShowModalOptions): Promise<string>
}

let windowMessageEmitter: WindowMessageEmitter = (pluginId, payload) => {
  console.log(`[host.window.showMessage] ${pluginId}: ${payload.message}`)
}

let modalDispatcher: ModalDispatcher = {
  async showWarning(pluginId, message) {
    console.warn(`[host.window.showWarning] ${pluginId}: ${message}`)
  },
  async showModal(pluginId, options) {
    console.warn(`[host.window.showModal] ${pluginId}: ${options.message}`)
    const buttons = options.buttons?.length ? options.buttons : [{ id: 'ok', label: 'OK' }]
    const cancel = buttons.find((b) => b.cancel) ?? buttons[0]!
    return cancel.id
  },
}

/**
 * Hook the desktop shell (or any other UI surface) into `host.window.showMessage`.
 * Call once at host startup; later calls replace the previous emitter.
 */
export function setWindowMessageEmitter(emitter: WindowMessageEmitter): void {
  windowMessageEmitter = emitter
}

/**
 * Hook the desktop shell into `host.window.showWarning` / `host.window.showModal`.
 * The default is a no-op that logs and (for showModal) returns the cancel-button id,
 * so CLI/headless contexts don't deadlock plugins waiting on user input.
 */
export function setModalDispatcher(dispatcher: ModalDispatcher): void {
  modalDispatcher = dispatcher
}

let registered = false

/**
 * Wire the bundled host-API methods (`window.*`, `workspace.*`) into the broker.
 * Idempotent — safe to call from every host entry point that imports the broker.
 */
export function registerHostApiHandlers(): void {
  if (registered) return
  registered = true

  registerHostHandler('window.showMessage', (pluginId, args) => {
    const payload = (args as WindowMessagePayload | undefined) ?? { message: '' }
    windowMessageEmitter(pluginId, payload)
    return null
  })

  registerHostHandler('window.showWarning', (pluginId, args) => {
    const { message, detail } = (args as { message: string; detail?: string } | undefined) ?? {
      message: '',
    }
    return modalDispatcher.showWarning(pluginId, message, detail)
  })

  registerHostHandler('window.showModal', (pluginId, args) => {
    return modalDispatcher.showModal(pluginId, (args as ShowModalOptions) ?? { message: '' })
  })

  registerHostHandler('workspace.getConfiguration', (pluginId) => {
    return getConfiguration(pluginId)
  })

  registerHostHandler('workspace.setConfiguration', (pluginId, args) => {
    return setConfiguration(pluginId, (args as Record<string, unknown>) ?? {})
  })
}
