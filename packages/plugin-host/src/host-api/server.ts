import { registerHostHandler } from '../broker.js'
import { getConfiguration, setConfiguration } from '../configuration.js'

export interface WindowMessagePayload {
  message: string
  level?: 'info' | 'warning' | 'error'
}

export type WindowMessageEmitter = (pluginId: string, payload: WindowMessagePayload) => void

let windowMessageEmitter: WindowMessageEmitter = (pluginId, payload) => {
  console.log(`[host.window.showMessage] ${pluginId}: ${payload.message}`)
}

/**
 * Hook the desktop shell (or any other UI surface) into `host.window.showMessage`.
 * Call once at host startup; later calls replace the previous emitter.
 */
export function setWindowMessageEmitter(emitter: WindowMessageEmitter): void {
  windowMessageEmitter = emitter
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

  registerHostHandler('workspace.getConfiguration', (pluginId) => {
    return getConfiguration(pluginId)
  })

  registerHostHandler('workspace.setConfiguration', (pluginId, args) => {
    return setConfiguration(pluginId, (args as Record<string, unknown>) ?? {})
  })
}
