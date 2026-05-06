import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  ThemeContribution,
  DeclarativeViewContribution,
  StatusBarContribution,
  WebviewContribution,
} from '@nodalcore/sdk'
import { PLUGINS_DIR } from './installer.js'
import { listInstalledPlugins } from './installer.js'

export interface AggregatedTheme {
  pluginId: string
  themeId: string
  label: string
  type: 'dark' | 'light'
  /** CSS custom-property overrides parsed from the theme JSON file. */
  vars: Record<string, string>
}

export interface AggregatedSidebarSlot {
  pluginId: string
  slotId: string
  name: string
  type: DeclarativeViewContribution['type']
}

export interface AggregatedStatusBarSlot {
  pluginId: string
  slotId: string
  alignment: 'left' | 'right'
  priority: number
}

export interface AggregatedPanelWebview {
  pluginId: string
  slotId: string
  name: string
  /** Path relative to the plugin install dir; empty if the plugin registers programmatically. */
  htmlPath: string
  csp?: WebviewContribution['csp']
}

export interface AggregatedContributions {
  themes: AggregatedTheme[]
  sidebar: AggregatedSidebarSlot[]
  statusBar: AggregatedStatusBarSlot[]
  panels: AggregatedPanelWebview[]
}

async function loadThemeVars(
  pluginDir: string,
  theme: ThemeContribution,
): Promise<Record<string, string>> {
  const file = path.resolve(pluginDir, theme.path)
  const raw = await fs.readFile(file, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/**
 * Walk the local plugin registry and produce a flat list of all declarative
 * contribution points: themes (with their CSS-var payloads loaded from disk),
 * sidebar slots, statusBar slots. The renderer pulls this once at startup
 * and re-pulls after install/uninstall.
 */
export async function listContributions(): Promise<AggregatedContributions> {
  const installed = await listInstalledPlugins()
  const themes: AggregatedTheme[] = []
  const sidebar: AggregatedSidebarSlot[] = []
  const statusBar: AggregatedStatusBarSlot[] = []
  const panels: AggregatedPanelWebview[] = []

  for (const entry of installed) {
    const { manifest } = entry
    const pluginId = manifest.id
    const pluginDir = path.join(PLUGINS_DIR, pluginId)
    const c = manifest.contributes
    if (!c) continue

    if (c.themes) {
      for (const theme of c.themes) {
        try {
          const vars = await loadThemeVars(pluginDir, theme)
          themes.push({
            pluginId,
            themeId: theme.id,
            label: theme.label,
            type: theme.type,
            vars,
          })
        } catch (err) {
          console.warn(
            `[contributions] failed to load theme ${pluginId}:${theme.id} —`,
            err instanceof Error ? err.message : err,
          )
        }
      }
    }

    const sidebarItems = c.views?.sidebar
    if (sidebarItems) {
      for (const slot of sidebarItems) {
        sidebar.push({ pluginId, slotId: slot.id, name: slot.name, type: slot.type })
      }
    }

    const statusBarItems = c.views?.statusBar
    if (statusBarItems) {
      for (const slot of statusBarItems) {
        statusBar.push({
          pluginId,
          slotId: slot.id,
          alignment: slot.alignment ?? 'left',
          priority: slot.priority ?? 0,
        })
      }
    }

    const panelItems = c.views?.panel
    if (panelItems) {
      for (const slot of panelItems) {
        panels.push({
          pluginId,
          slotId: slot.id,
          name: slot.name,
          htmlPath: slot.html ?? '',
          csp: slot.csp,
        })
      }
    }
  }

  // Stable order: by pluginId, then declaration order.
  themes.sort((a, b) =>
    a.pluginId.localeCompare(b.pluginId) || a.themeId.localeCompare(b.themeId),
  )
  sidebar.sort((a, b) =>
    a.pluginId.localeCompare(b.pluginId) || a.slotId.localeCompare(b.slotId),
  )
  // statusBar within each side, higher priority first.
  statusBar.sort((a, b) => {
    if (a.alignment !== b.alignment) return a.alignment === 'left' ? -1 : 1
    return b.priority - a.priority
  })
  panels.sort((a, b) =>
    a.pluginId.localeCompare(b.pluginId) || a.slotId.localeCompare(b.slotId),
  )

  return { themes, sidebar, statusBar, panels }
}
