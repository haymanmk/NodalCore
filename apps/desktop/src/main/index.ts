import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import {
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
  loadDevicePlugin,
  unloadDevicePlugin,
  sendToPlugin,
  spawnTool,
  stopTool,
  reconcileRegistry,
  getConfiguration,
  setConfiguration,
  registerHostApiHandlers,
  setWindowMessageEmitter,
  listContributions,
} from '@nodalcore/plugin-host'
import type { ConnectionOptions } from '@nodalcore/sdk'
import {
  registerSchemePrivileges,
  registerProtocolHandler,
} from './webviews/protocol.js'
import {
  setParentWindow,
  setPanelBounds,
  showPanel,
  hideActive,
  destroy as destroyPanel,
} from './webviews/manager.js'
import { registerWebviewRouting } from './webviews/routing.js'

// MUST run before app.whenReady() — privileged scheme registration is one of
// the few things Electron locks once the app is ready.
registerSchemePrivileges()

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  setParentWindow(mainWindow)

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  reconcileRegistry().catch(console.error)
  registerHostApiHandlers()
  setWindowMessageEmitter((pluginId, payload) => {
    mainWindow?.webContents.send('host:window:showMessage', { pluginId, ...payload })
  })
  registerProtocolHandler()
  registerWebviewRouting({
    invokeOnPlugin: async (pluginId, slotId, data) => {
      try {
        return await sendToPlugin(pluginId, 'views.message', { slotId, data })
      } catch (err) {
        // Standalone tools have no host → tool callback path today; treat as
        // "panel handled it locally" rather than escalating.
        if (err instanceof Error && err.message.includes('not loaded')) {
          throw err
        }
        return null
      }
    },
  })
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------------------
// IPC handlers — these are the safe API surface exposed to the renderer
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  // Plugin management
  ipcMain.handle('plugin:list', async () => {
    return listInstalledPlugins()
  })

  ipcMain.handle('plugin:install', async (_event, idOrUrl: string) => {
    return installPlugin({ source: idOrUrl })
  })

  ipcMain.handle('plugin:uninstall', async (_event, pluginId: string) => {
    return uninstallPlugin(pluginId)
  })

  // Device-bridge plugins
  ipcMain.handle('device:connect', async (_event, pluginId: string, _options: ConnectionOptions) => {
    await loadDevicePlugin(pluginId)
    return { success: true }
  })

  ipcMain.handle('device:disconnect', async (_event, pluginId: string) => {
    await unloadDevicePlugin(pluginId)
    return { success: true }
  })

  // Settings — backed by host-side configuration store (~/.nodalcore/configurations.json).
  // Settings are no longer plugin-resident; plugins read them via host.workspace.getConfiguration.
  ipcMain.handle('settings:read', async (_event, pluginId: string) => {
    return getConfiguration(pluginId)
  })

  ipcMain.handle('settings:write', async (_event, pluginId: string, settings: Record<string, unknown>) => {
    await setConfiguration(pluginId, settings)
    return { success: true }
  })

  // Standalone tools
  ipcMain.handle('tool:start', async (_event, pluginId: string) => {
    const tool = await spawnTool(pluginId)
    return { port: tool.port }
  })

  ipcMain.handle('tool:stop', async (_event, pluginId: string) => {
    await stopTool(pluginId)
    return { success: true }
  })

  // Aggregated declarative contributions (themes + sidebar/statusBar slots + panels).
  ipcMain.handle('contributions:list', async () => {
    return listContributions()
  })

  // Workspace tab — webview lifecycle.
  ipcMain.handle(
    'workspace:show-panel',
    async (_event, pluginId: string, slotId: string, htmlPath: string) => {
      const preloadPath = path.join(__dirname, '../preload/webview.js')
      showPanel({ pluginId, slotId, htmlPath, preloadPath })
      return { success: true }
    },
  )

  ipcMain.handle('workspace:hide-panel', async () => {
    hideActive()
    return { success: true }
  })

  ipcMain.handle(
    'workspace:destroy-panel',
    async (_event, pluginId: string, slotId: string) => {
      destroyPanel(pluginId, slotId)
      return { success: true }
    },
  )

  // Renderer reports the panel rectangle (in CSS pixels relative to the
  // BrowserWindow content area). Main updates the active WebContentsView's
  // bounds — main owns layout for the panel region per the no-overlap rule.
  ipcMain.handle(
    'workspace:set-bounds',
    async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      setPanelBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      })
      return { success: true }
    },
  )
}
