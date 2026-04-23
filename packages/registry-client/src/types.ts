import type { PluginType, ConnectionType, Permission } from '@nodalcore/sdk'

/** A single entry in the central registry index. */
export interface RegistryPluginEntry {
  id: string
  name: string
  version: string
  description: string
  icon: string
  type: PluginType
  connectionType?: ConnectionType
  permissions: Permission[]
  tags: string[]
  author?: {
    name: string
    url?: string
  }
  repository: string
  /** Direct URL to the nodal.json manifest in the repository */
  manifestUrl: string
  /** Number of installs, provided by the registry server */
  installs?: number
  updatedAt: string
}

export interface RegistryIndex {
  version: string
  updatedAt: string
  plugins: RegistryPluginEntry[]
}
