import { dialog } from 'electron'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { ShowModalOptions } from '@nodalcore/sdk'
import { getWindow } from '../window-state.js'

/**
 * Hard ceiling on in-flight + queued plugin-driven modals. A runaway plugin
 * (e.g. a connect loop that calls showModal on every retry) could otherwise
 * trap the user behind a long chain of dialogs they have to dismiss one by
 * one. Past the cap, new modals resolve immediately with their cancel-button
 * id (same shape as if the user had pressed Esc on a real dialog) and warnings
 * resolve to undefined. The plugin's await still completes — it just doesn't
 * get to display.
 *
 * When tuning: this counts both the dialog currently on-screen and the ones
 * waiting behind it. With 6, the user clicks through at most 6 stacked
 * dialogs even if a plugin emits hundreds.
 */
export const MODAL_QUEUE_MAX = 6

let queueDepth = 0
let chain: Promise<unknown> = Promise.resolve()

function isFull(): boolean {
  return queueDepth >= MODAL_QUEUE_MAX
}

/** Test-only: clear the queue's module state so suite tests can't leak depth into each other. */
export function __resetModalQueueForTests(): void {
  queueDepth = 0
  chain = Promise.resolve()
}

function showBox(opts: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  const w = getWindow()
  return w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts)
}

export async function showWarning(
  pluginId: string,
  message: string,
  detail?: string,
): Promise<void> {
  if (isFull()) {
    console.warn(
      `[host.modal] dropping showWarning from ${pluginId} — queue at cap (${MODAL_QUEUE_MAX}). message=${JSON.stringify(message)}`,
    )
    return
  }
  queueDepth++
  const next = chain
    .then(() =>
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
    .finally(() => {
      queueDepth--
    })
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

  if (isFull()) {
    console.warn(
      `[host.modal] dropping showModal from ${pluginId} — queue at cap (${MODAL_QUEUE_MAX}). Resolving with cancel button id "${buttons[cancelId]!.id}". message=${JSON.stringify(options.message)}`,
    )
    return buttons[cancelId]!.id
  }

  queueDepth++
  const next = chain
    .then(() =>
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
    .finally(() => {
      queueDepth--
    })
  chain = next.catch(() => {})
  const { response } = await next
  return buttons[response]!.id
}
