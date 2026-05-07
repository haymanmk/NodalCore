import { Tray, Menu, app, nativeImage } from 'electron'
import { showWindow, beginQuit } from './window-state.js'
import { getQueueLength, onQueueChange } from './notifications/queue.js'
import {
  TRAY_ICON_PNG_BASE64,
  TRAY_ICON_2X_PNG_BASE64,
  TRAY_ICON_TEMPLATE_PNG_BASE64,
} from './assets/tray-icon.js'

let tray: Tray | null = null

export function createTray(): void {
  if (tray) return

  const icon = process.platform === 'darwin'
    ? nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_TEMPLATE_PNG_BASE64, 'base64'))
    : nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, 'base64'))

  if (process.platform === 'darwin') {
    icon.setTemplateImage(true)
  } else {
    icon.addRepresentation({
      scaleFactor: 2,
      buffer: Buffer.from(TRAY_ICON_2X_PNG_BASE64, 'base64'),
    })
  }

  tray = new Tray(icon)
  tray.setToolTip('NodalCore')
  rebuildMenu()
  tray.on('click', showWindow)
  onQueueChange(rebuildMenu)
}

function rebuildMenu(): void {
  if (!tray) return
  const unread = getQueueLength()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: unread > 0 ? `Open NodalCore (${unread} unread)` : 'Open NodalCore',
        click: showWindow,
      },
      { type: 'separator' },
      {
        label: 'Quit NodalCore',
        click: () => {
          beginQuit()
          app.quit()
        },
      },
    ]),
  )
  tray.setToolTip(unread > 0 ? `NodalCore — ${unread} unread` : 'NodalCore')
  if (process.platform === 'darwin') tray.setTitle(unread > 0 ? '•' : '')
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
