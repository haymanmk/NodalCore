import { app, BrowserWindow, ipcMain, net } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import {
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
  loadDevicePlugin,
  unloadDevicePlugin,
  sendToPlugin,
  listLoadedPlugins,
  spawnTool,
  stopTool,
  reconcileRegistry,
  getConfiguration,
  setConfiguration,
  setConfigurationChangeEmitter,
  autoStartInstalledPlugins,
  registerHostApiHandlers,
  setWindowMessageEmitter,
  setModalDispatcher,
  listContributions,
  getConnectionOptions,
  setConnectionOptions,
  setFetcher as setArtifactFetcher,
} from '@nodalcore/plugin-host'
import { setFetcher as setRegistryFetcher } from '@nodalcore/registry-client'
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
import { createTray } from './tray.js'
import {
  bindWindow,
  isWindowVisible,
  isQuitting,
  showWindow,
} from './window-state.js'
import { enqueue, drain } from './notifications/queue.js'
import { showWarning, showModal } from './notifications/modal.js'

// MUST run before app.whenReady() — privileged scheme registration is one of
// the few things Electron locks once the app is ready.
registerSchemePrivileges()

// Single-instance: a second invocation of `nodalcore` while the app is
// running in the tray should just re-show the existing window, not start
// a second process.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
  })
}

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

  bindWindow(mainWindow)
  setParentWindow(mainWindow)

  mainWindow.on('close', (e) => {
    if (!isQuitting()) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    bindWindow(null)
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // Route registry + artifact downloads through Electron's net stack so TLS
  // verification consults the OS root store. This is what makes plugin
  // installs work on corporate Windows machines whose proxy MITMs TLS with a
  // company-internal root CA (the CA is in the Windows cert store but Node's
  // bundled CA list doesn't know about it).
  const electronFetch = net.fetch.bind(net) as (
    input: string,
    init?: { signal?: AbortSignal },
  ) => Promise<Response>
  setRegistryFetcher(electronFetch)
  setArtifactFetcher(electronFetch)

  reconcileRegistry().catch(console.error)
  registerHostApiHandlers()
  setWindowMessageEmitter((pluginId, payload) => {
    if (isWindowVisible()) {
      mainWindow?.webContents.send('host:window:showMessage', { pluginId, ...payload })
    } else {
      enqueue({
        pluginId,
        message: payload.message,
        level: payload.level ?? 'info',
        ts: Date.now(),
      })
    }
  })
  setModalDispatcher({ showWarning, showModal })
  setConfigurationChangeEmitter(async (pluginId, newConfig) => {
    try {
      await sendToPlugin(pluginId, 'workspace.configurationChanged', newConfig)
    } catch (err) {
      // Plugin not loaded → nothing to notify; any other failure is logged
      // by configuration.ts's catch wrapper.
      if (!(err instanceof Error) || !err.message.includes('not loaded')) {
        throw err
      }
    }
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
  createTray()
  createWindow()

  // Fire-and-forget: bring up plugins flagged with autoStart. The orchestrator
  // contains per-plugin failures; toasts queue while the renderer mounts and
  // are flushed on host:ready, so we don't need to wait for the window here.
  void autoStartInstalledPlugins({
    emit: (level, message) => emitSystemToast(level, message),
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Note: `window-all-closed` is intentionally NOT handled. The tray "Quit"
// item (which calls beginQuit() then app.quit()) is the only exit path —
// closing the window via [X] is intercepted in createWindow() and routed
// to mainWindow.hide() instead.

// ---------------------------------------------------------------------------
// IPC handlers — these are the safe API surface exposed to the renderer
// ---------------------------------------------------------------------------

// Sentinel pluginId for host-originated toasts so the renderer's
// HostMessageToast can render IPC-handler failures the same way it renders
// plugin window.showMessage events.
const SYSTEM_TOAST_SOURCE = 'NodalCore'

function emitSystemToast(level: 'info' | 'warning' | 'error', message: string) {
  if (isWindowVisible()) {
    mainWindow?.webContents.send('host:window:showMessage', {
      pluginId: SYSTEM_TOAST_SOURCE,
      level,
      message,
    })
  } else {
    // Auto-start (and any other pre-renderer host-side path) hits this branch.
    // The renderer drains the queue via host:ready on mount.
    enqueue({
      pluginId: SYSTEM_TOAST_SOURCE,
      message,
      level,
      ts: Date.now(),
    })
  }
}

// Wrap an IPC handler so any thrown error is surfaced to the user as an error
// toast in addition to rejecting the renderer-side promise. Without this,
// fatal main-side errors (failed git clone, manifest validation, sdk-version
// mismatch, …) only appear in the dev console.
function safeHandle<Args extends unknown[]>(
  channel: string,
  label: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<unknown>,
) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...(args as Args))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      emitSystemToast('error', `${label} failed: ${message}`)
      throw err
    }
  })
}

function registerIpcHandlers() {
  // Plugin management
  safeHandle('plugin:list', 'List plugins', async () => {
    // Merge live runtime state into the persisted registry entries. The
    // registry only records install state ('idle'); 'running' is computed
    // from the loader's in-memory loaded map at request time.
    const entries = await listInstalledPlugins()
    const running = new Set(listLoadedPlugins())
    return entries.map((entry) =>
      running.has(entry.manifest.id)
        ? { ...entry, status: 'running' as const }
        : entry,
    )
  })

  safeHandle('plugin:install', 'Install plugin', async (_event, idOrUrl: string) => {
    return installPlugin({ source: idOrUrl })
  })

  safeHandle('plugin:uninstall', 'Uninstall plugin', async (_event, pluginId: string) => {
    return uninstallPlugin(pluginId)
  })

  // Device-bridge plugins
  safeHandle('device:connect', 'Connect device', async (_event, pluginId: string, options?: ConnectionOptions) => {
    const proxy = await loadDevicePlugin(pluginId)
    await proxy.connect((options ?? {}) as ConnectionOptions)
    // Persist only after a successful connect. Skips persistence when the
    // renderer omitted options (legacy/no-dialog path) so we don't overwrite
    // a good stored value with an empty fallback.
    if (options) await setConnectionOptions(pluginId, options)
    return { success: true }
  })

  safeHandle('device:disconnect', 'Disconnect device', async (_event, pluginId: string) => {
    await unloadDevicePlugin(pluginId)
    return { success: true }
  })

  safeHandle(
    'connection:read',
    'Read stored connection options',
    async (_event, pluginId: string, expectedType: string) => {
      return getConnectionOptions(pluginId, expectedType)
    },
  )

  // Settings — backed by host-side configuration store (~/.nodalcore/configurations.json).
  // Settings are no longer plugin-resident; plugins read them via host.workspace.getConfiguration.
  safeHandle('settings:read', 'Read settings', async (_event, pluginId: string) => {
    return getConfiguration(pluginId)
  })

  safeHandle(
    'settings:write',
    'Write settings',
    async (_event, pluginId: string, settings: Record<string, unknown>) => {
      await setConfiguration(pluginId, settings)
      return { success: true }
    },
  )

  // Standalone tools
  safeHandle('tool:start', 'Start tool', async (_event, pluginId: string) => {
    const tool = await spawnTool(pluginId)
    return { port: tool.port }
  })

  safeHandle('tool:stop', 'Stop tool', async (_event, pluginId: string) => {
    await stopTool(pluginId)
    return { success: true }
  })

  // Aggregated declarative contributions (themes + sidebar/statusBar slots + panels).
  safeHandle('contributions:list', 'List contributions', async () => {
    return listContributions()
  })

  // Workspace tab — webview lifecycle.
  safeHandle(
    'workspace:show-panel',
    'Show panel',
    async (_event, pluginId: string, slotId: string, htmlPath: string) => {
      const preloadPath = path.join(__dirname, '../preload/webview.js')
      showPanel({ pluginId, slotId, htmlPath, preloadPath })
      return { success: true }
    },
  )

  safeHandle('workspace:hide-panel', 'Hide panel', async () => {
    hideActive()
    return { success: true }
  })

  safeHandle(
    'workspace:destroy-panel',
    'Destroy panel',
    async (_event, pluginId: string, slotId: string) => {
      destroyPanel(pluginId, slotId)
      return { success: true }
    },
  )

  // Renderer reports the panel rectangle (in CSS pixels relative to the
  // BrowserWindow content area). Main updates the active WebContentsView's
  // bounds — main owns layout for the panel region per the no-overlap rule.
  safeHandle(
    'workspace:set-bounds',
    'Set workspace bounds',
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

  // Renderer signals it has mounted; drain any toasts that were emitted
  // while the window was hidden and re-emit them so HostMessageToast can
  // render them.
  ipcMain.handle('host:ready', () => {
    for (const t of drain()) {
      mainWindow?.webContents.send('host:window:showMessage', {
        pluginId: t.pluginId,
        message: t.message,
        level: t.level,
      })
    }
  })
}
