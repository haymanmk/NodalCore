import type { RegistryIndex, RegistryPluginEntry, RegistryArtifact } from './types.js'

export type { RegistryIndex, RegistryPluginEntry, RegistryArtifact }

/**
 * Default registry index URL.
 * In production this points to the GitHub Pages hosted index.json.
 * Override via NODALCORE_REGISTRY_URL environment variable or the
 * `registryUrl` option on client methods.
 */
const envRegistryUrl = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env?.NODALCORE_REGISTRY_URL
const DEFAULT_REGISTRY_URL =
  envRegistryUrl || 'https://haymanmk.github.io/NodalCore-Store/registry/index.json'

let cachedIndex: RegistryIndex | null = null
let cachedAt = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export type Fetcher = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>

// Indirection so Electron's main process can swap in `net.fetch` — that path
// uses Chromium's TLS stack and the OS root store, which is required on
// corporate Windows machines whose TLS-intercepting proxy presents a CA Node
// doesn't trust out of the box.
let currentFetch: Fetcher = (input, init) => globalThis.fetch(input, init)

export function setFetcher(fn: Fetcher): void {
  currentFetch = fn
}

export interface FetchOptions {
  registryUrl?: string
  /** Force bypass cache */
  force?: boolean
  /** AbortSignal for fetch cancellation */
  signal?: AbortSignal
}

/** Fetch (and cache) the full registry index. */
export async function fetchIndex(options: FetchOptions = {}): Promise<RegistryIndex> {
  const url = options.registryUrl ?? DEFAULT_REGISTRY_URL
  const now = Date.now()

  if (!options.force && cachedIndex && now - cachedAt < CACHE_TTL_MS) {
    return cachedIndex
  }

  const response = await currentFetch(url, { signal: options.signal })
  if (!response.ok) {
    throw new Error(`Registry fetch failed: ${response.status} ${response.statusText}`)
  }

  const index = (await response.json()) as RegistryIndex
  cachedIndex = index
  cachedAt = now
  return index
}

export interface SearchOptions extends FetchOptions {
  query: string
  type?: 'device-bridge' | 'standalone-tool'
  tags?: string[]
}

/** Search the registry index by name, description, or tags. */
export async function searchPlugins(options: SearchOptions): Promise<RegistryPluginEntry[]> {
  const index = await fetchIndex(options)
  const q = options.query.toLowerCase()

  return index.plugins.filter((p) => {
    const matchesQuery =
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))

    const matchesType = options.type ? p.type === options.type : true
    const matchesTags =
      options.tags && options.tags.length > 0
        ? options.tags.every((t) => p.tags.includes(t))
        : true

    return matchesQuery && matchesType && matchesTags
  })
}

/** Get a single plugin entry by id. */
export async function getPlugin(
  id: string,
  options: FetchOptions = {},
): Promise<RegistryPluginEntry | undefined> {
  const index = await fetchIndex(options)
  return index.plugins.find((p) => p.id === id)
}
