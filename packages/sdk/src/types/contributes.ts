import type { JSONSchema7 } from 'json-schema'

export interface ThemeContribution {
  id: string
  label: string
  type: 'dark' | 'light'
  /** Path to a JSON file of CSS custom-property overrides, relative to plugin root. */
  path: string
}

export interface ConfigurationContribution {
  title?: string
  /** JSON Schema 7 property map describing the plugin's settings. */
  properties: Record<string, JSONSchema7>
}

export type DeclarativeViewSlotType = 'list' | 'tree' | 'form'

export interface DeclarativeViewContribution {
  id: string
  name: string
  type: DeclarativeViewSlotType
}

export interface StatusBarContribution {
  id: string
  alignment?: 'left' | 'right'
  /** Higher priority items appear closer to the centre of their alignment side. */
  priority?: number
}

export interface WebviewCsp {
  'connect-src'?: string[]
  'img-src'?: string[]
  'style-src'?: string[]
  'script-src'?: string[]
  'font-src'?: string[]
  'media-src'?: string[]
}

export interface WebviewContribution {
  id: string
  name: string
  /**
   * Path to the HTML entry, relative to plugin root.
   * Optional — the plugin may register a provider programmatically via host.views.registerWebview.
   */
  html?: string
  /** Optional CSP additions merged into the default `'self' nodal-plugin://<pluginId>` policy. */
  csp?: WebviewCsp
}

export interface Contributes {
  configuration?: ConfigurationContribution
  themes?: ThemeContribution[]
  views?: {
    sidebar?: DeclarativeViewContribution[]
    statusBar?: StatusBarContribution[]
    /** Webview slots — rendered in the Workspace tab's panel region, one visible at a time. */
    panel?: WebviewContribution[]
  }
}
