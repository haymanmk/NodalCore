import {
  WebContentsView,
  type BrowserWindow,
  type Rectangle,
  type WebContents,
} from 'electron'
import path from 'node:path'

interface ManagedView {
  view: WebContentsView
  pluginId: string
  slotId: string
  htmlPath: string
}

const views = new Map<string, ManagedView>()
const byWebContentsId = new Map<number, ManagedView>()
let parentWin: BrowserWindow | null = null
let activeKey: string | null = null
let panelBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }

function k(pluginId: string, slotId: string): string {
  return `${pluginId}::${slotId}`
}

/**
 * Wire the manager to the BrowserWindow whose `contentView` will host panel
 * webviews. Re-installs view-cleanup on `did-finish-load` so renderer hot
 * reloads don't accumulate orphaned native views.
 */
export function setParentWindow(win: BrowserWindow): void {
  parentWin = win

  win.webContents.on('did-finish-load', () => {
    // The React app just (re)loaded. Tear down all child views; the renderer
    // will request them again as the user navigates back to a panel.
    destroyAll()
  })

  win.on('closed', () => {
    destroyAll()
    parentWin = null
  })
}

export function setPanelBounds(bounds: Rectangle): void {
  panelBounds = bounds
  if (activeKey) {
    const m = views.get(activeKey)
    m?.view.setBounds(bounds)
  }
}

/**
 * Show (creating if necessary) the panel webview for `(pluginId, slotId)`.
 * Hides whichever view was previously active — only one is visible at a time.
 */
export function showPanel(opts: {
  pluginId: string
  slotId: string
  htmlPath: string
  preloadPath: string
}): void {
  if (!parentWin) throw new Error('webviews/manager: no parent window registered')
  const key = k(opts.pluginId, opts.slotId)
  let entry = views.get(key)
  if (!entry) {
    const view = new WebContentsView({
      webPreferences: {
        preload: opts.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    parentWin.contentView.addChildView(view)
    const target = `nodal-plugin://${opts.pluginId}/${opts.htmlPath.replace(/^\//, '')}`
    void view.webContents.loadURL(target).catch((err) => {
      console.error('[webviews] loadURL failed:', target, err)
    })
    entry = { view, pluginId: opts.pluginId, slotId: opts.slotId, htmlPath: opts.htmlPath }
    views.set(key, entry)
    byWebContentsId.set(view.webContents.id, entry)
  }

  if (activeKey && activeKey !== key) {
    const prev = views.get(activeKey)
    prev?.view.setVisible(false)
  }
  entry.view.setBounds(panelBounds)
  entry.view.setVisible(true)
  activeKey = key
}

export function hideActive(): void {
  if (!activeKey) return
  const m = views.get(activeKey)
  m?.view.setVisible(false)
  activeKey = null
}

export function destroy(pluginId: string, slotId: string): void {
  const key = k(pluginId, slotId)
  const entry = views.get(key)
  if (!entry) return
  byWebContentsId.delete(entry.view.webContents.id)
  try {
    parentWin?.contentView.removeChildView(entry.view)
  } catch {
    // already removed
  }
  try {
    entry.view.webContents.close()
  } catch {
    // already closed
  }
  views.delete(key)
  if (activeKey === key) activeKey = null
}

export function destroyAll(): void {
  for (const entry of views.values()) {
    byWebContentsId.delete(entry.view.webContents.id)
    try {
      parentWin?.contentView.removeChildView(entry.view)
    } catch {
      // ignore
    }
    try {
      entry.view.webContents.close()
    } catch {
      // ignore
    }
  }
  views.clear()
  activeKey = null
}

export function getActive(): { pluginId: string; slotId: string } | null {
  if (!activeKey) return null
  const m = views.get(activeKey)
  if (!m) return null
  return { pluginId: m.pluginId, slotId: m.slotId }
}

export function findByWebContents(wc: WebContents): { pluginId: string; slotId: string } | null {
  const m = byWebContentsId.get(wc.id)
  return m ? { pluginId: m.pluginId, slotId: m.slotId } : null
}

/** Push a message to the panel webview. Returns false if no view is open for that slot. */
export function sendToPanel(pluginId: string, slotId: string, data: unknown): boolean {
  const entry = views.get(k(pluginId, slotId))
  if (!entry) return false
  entry.view.webContents.send('webview:msg-from-plugin', data)
  return true
}

export function preloadResolverDir(): string {
  // Paired with electron-vite's preload bundle layout: dist/preload/webview.js
  return path.dirname(__dirname)
}
