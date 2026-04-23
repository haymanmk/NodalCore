import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import _Ajv from 'ajv'
import _addFormats from 'ajv-formats'
import type { PluginManifest } from '@nodalcore/sdk'

const execFileAsync = promisify(execFile)

const PLUGINS_DIR = path.join(os.homedir(), '.nodalcore', 'plugins')
const REGISTRY_FILE = path.join(os.homedir(), '.nodalcore', 'registry.json')

// Minimal JSON Schema for nodal.json validation
const MANIFEST_SCHEMA = {
  type: 'object' as const,
  required: ['id', 'name', 'version', 'sdkVersion', 'type', 'settingsSchema', 'permissions'],
  properties: {
    id: { type: 'string' as const, minLength: 1 },
    name: { type: 'string' as const, minLength: 1 },
    version: { type: 'string' as const },
    sdkVersion: { type: 'string' as const },
    type: { type: 'string' as const, enum: ['device-bridge', 'standalone-tool'] },
    settingsSchema: { type: 'object' as const },
    permissions: { type: 'array' as const, items: { type: 'string' as const } },
    connectionType: {
      type: 'string' as const,
      enum: ['serial', 'usb', 'bluetooth', 'tcp', 'mqtt'],
    },
  },
  additionalProperties: true,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv = (_Ajv as any).default ?? _Ajv
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormats = (_addFormats as any).default ?? _addFormats
const ajv = new Ajv()
addFormats(ajv)
const validateManifest = ajv.compile(MANIFEST_SCHEMA)

export interface InstallOptions {
  /** Git URL or local file path to a plugin zip/directory */
  source: string
  onProgress?: (message: string) => void
}

export async function installPlugin(options: InstallOptions): Promise<PluginManifest> {
  const { source, onProgress } = options
  const log = (msg: string) => onProgress?.(msg)

  await fs.mkdir(PLUGINS_DIR, { recursive: true })

  let pluginDir: string

  if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('git@')) {
    // Derive a temporary id from the git URL to name the clone directory
    const repoName = source.split('/').pop()?.replace(/\.git$/, '') ?? 'unknown'
    pluginDir = path.join(PLUGINS_DIR, `_tmp_${repoName}_${Date.now()}`)
    log(`Cloning ${source}…`)
    await execFileAsync('git', ['clone', '--depth', '1', source, pluginDir])
    log('Clone complete.')
  } else {
    // Local directory — use directly
    pluginDir = path.resolve(source)
  }

  const manifest = await readAndValidateManifest(pluginDir)
  log(`Manifest validated: ${manifest.id}@${manifest.version}`)

  // If cloned to a temp dir, rename to the official plugin id directory
  const finalDir = path.join(PLUGINS_DIR, manifest.id)
  if (pluginDir !== finalDir) {
    await fs.rm(finalDir, { recursive: true, force: true })
    await fs.rename(pluginDir, finalDir)
  }

  await upsertRegistry(manifest)
  log(`Installed ${manifest.id}@${manifest.version}`)
  return manifest
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const pluginDir = path.join(PLUGINS_DIR, pluginId)
  await fs.rm(pluginDir, { recursive: true, force: true })
  await removeFromRegistry(pluginId)
}

export async function readAndValidateManifest(pluginDir: string): Promise<PluginManifest> {
  const manifestPath = path.join(pluginDir, 'nodal.json')
  let raw: string
  try {
    raw = await fs.readFile(manifestPath, 'utf8')
  } catch {
    throw new Error(`nodal.json not found in ${pluginDir}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`nodal.json in ${pluginDir} is not valid JSON`)
  }

  if (!validateManifest(parsed)) {
    const errors = ajv.errorsText(validateManifest.errors)
    throw new Error(`nodal.json validation failed: ${errors}`)
  }

  return parsed as PluginManifest
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

interface RegistryEntry {
  manifest: PluginManifest
  installedAt: string
  status: 'idle' | 'running' | 'error'
}

type Registry = Record<string, RegistryEntry>

async function readRegistry(): Promise<Registry> {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, 'utf8')
    return JSON.parse(raw) as Registry
  } catch {
    return {}
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await fs.mkdir(path.dirname(REGISTRY_FILE), { recursive: true })
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf8')
}

async function upsertRegistry(manifest: PluginManifest): Promise<void> {
  const registry = await readRegistry()
  registry[manifest.id] = {
    manifest,
    installedAt: new Date().toISOString(),
    status: 'idle',
  }
  await writeRegistry(registry)
}

async function removeFromRegistry(pluginId: string): Promise<void> {
  const registry = await readRegistry()
  delete registry[pluginId]
  await writeRegistry(registry)
}

export async function listInstalledPlugins(): Promise<RegistryEntry[]> {
  const registry = await readRegistry()
  return Object.values(registry)
}

export async function getInstalledPlugin(pluginId: string): Promise<RegistryEntry | undefined> {
  const registry = await readRegistry()
  return registry[pluginId]
}

export { PLUGINS_DIR }
