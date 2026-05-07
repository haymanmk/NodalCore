import { dialog } from 'electron'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { ShowModalOptions } from '@nodalcore/sdk'
import { getWindow } from '../window-state.js'

let chain: Promise<unknown> = Promise.resolve()

function showBox(opts: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  const w = getWindow()
  return w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts)
}

export async function showWarning(
  pluginId: string,
  message: string,
  detail?: string,
): Promise<void> {
  const next = chain.then(() =>
    showBox({
      type: 'warning',
      title: pluginId,
      message,
      detail,
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
    }),
  )
  chain = next.catch(() => {})
  await next
}

export async function showModal(
  pluginId: string,
  options: ShowModalOptions,
): Promise<string> {
  const buttons = options.buttons?.length
    ? options.buttons
    : [{ id: 'ok', label: 'OK', default: true }]

  const labels = buttons.map((b) => b.label)
  const defaultId = Math.max(0, buttons.findIndex((b) => b.default))
  const cancelIdx = buttons.findIndex((b) => b.cancel)
  const cancelId = cancelIdx >= 0 ? cancelIdx : 0

  const next = chain.then(() =>
    showBox({
      type: options.type ?? 'info',
      title: pluginId,
      message: options.message,
      detail: options.detail,
      buttons: labels,
      defaultId,
      cancelId,
      noLink: true,
    }),
  )
  chain = next.catch(() => {})
  const { response } = await next
  return buttons[response]!.id
}
