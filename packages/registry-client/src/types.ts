import type { PluginType, ConnectionType, Permission } from '@nodalcore/sdk'

/**
 * A prebuilt install artifact for a specific OS / CPU / libc / Node combination.
 * Hosts download, verify, and unpack these instead of running package-manager
 * installs on the user's machine.
 */
export interface RegistryArtifact {
  /** Direct download URL for the artifact (typically a `.tgz`). */
  url: string
  /** SHA-256 digest in `sha256:<hex>` format. */
  integrity: string
  /** Target `process.platform` (e.g. "linux", "darwin", "win32"). */
  os: 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'
  /** Target `process.arch` (e.g. "x64", "arm64"). */
  cpu: 'arm' | 'arm64' | 'ia32' | 'mips' | 'mipsel' | 'ppc' | 'ppc64' | 'riscv64' | 's390' | 's390x' | 'x64' | 'loong64'
  /** Optional Linux libc selector. Ignored on non-Linux platforms. */
  libc?: 'glibc' | 'musl'
  /** Optional semver range describing the compatible Node.js runtime. */
  nodeRange?: string
  /** Optional byte size for display and validation. */
  size?: number
}

/** A single entry in the central registry index. */
export interface RegistryPluginEntry {
  id: string
  name: string
  version: string
  description: string
  icon?: string
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
  /**
   * Prebuilt install artifacts. When present, the host should prefer a
   * matching artifact over cloning `repository`.
   */
  artifacts?: RegistryArtifact[]
  /** Number of installs, provided by the registry server */
  installs?: number
  updatedAt: string
}

export interface RegistryIndex {
  version: string
  updatedAt: string
  plugins: RegistryPluginEntry[]
}
