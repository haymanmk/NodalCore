import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import {
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
  loadDevicePlugin,
  unloadDevicePlugin,
  spawnTool,
  stopTool,
  reconcileRegistry,
  getConfiguration,
  setConfiguration,
  registerHostApiHandlers,
  setWindowMessageEmitter,
} from '@nodalcore/plugin-host'
import type { ConnectionOptions } from '@nodalcore/sdk'

// Keep a global reference to the window to prevent garbage collection
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

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  reconcileRegistry().catch(console.error)
  registerHostApiHandlers()
  setWindowMessageEmitter((pluginId, payload) => {
    mainWindow?.webContents.send('host:window:showMessage', { pluginId, ...payload })
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
  ipcMain.handle('device:connect', async (_event, pluginId: string, options: ConnectionOptions) => {
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
}
