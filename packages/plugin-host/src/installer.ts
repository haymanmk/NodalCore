import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import _Ajv from 'ajv'
import _addFormats from 'ajv-formats'
import type { PluginManifest } from '@nodalcore/sdk'
import type { RegistryArtifact, RegistryPluginEntry } from '@nodalcore/registry-client'
import { getPlugin } from '@nodalcore/registry-client'
import {
  describeCurrentPlatform,
  downloadArtifact,
  selectArtifact,
  unpackArtifact,
  UnsupportedPlatformError,
  verifyIntegrity,
} from './artifact.js'

const execFileAsync = promisify(execFile)

const PLUGINS_DIR = path.join(os.homedir(), '.nodalcore', 'plugins')
const REGISTRY_FILE = path.join(os.homedir(), '.nodalcore', 'registry.json')

const MANIFEST_SCHEMA = {
  type: 'object' as const,
  required: ['id', 'name', 'version', 'sdkVersion', 'type', 'permissions'],
  properties: {
    id: { type: 'string' as const, minLength: 1 },
    name: { type: 'string' as const, minLength: 1 },
    version: { type: 'string' as const },
    sdkVersion: { type: 'string' as const },
    type: { type: 'string' as const, enum: ['device-bridge', 'standalone-tool'] },
    main: { type: 'string' as const },
    executable: { type: 'string' as const },
    protoFile: { type: 'string' as const },
    permissions: { type: 'array' as const, items: { type: 'string' as const } },
    connectionType: {
      type: 'string' as const,
      enum: ['serial', 'usb', 'bluetooth', 'tcp', 'mqtt'],
    },
    contributes: { type: 'object' as const },
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
  /** Git URL, local directory path, or registry plugin id */
  source: string
  /** Override the registry index URL used for id lookups */
  registryUrl?: string
  onProgress?: (message: string) => void
}

function isGitUrl(source: string): boolean {
  return (
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('git@')
  )
}

async function isExistingDirectory(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

type ResolvedSource =
  | { kind: 'git'; url: string }
  | { kind: 'local'; dir: string }
  | { kind: 'artifact'; entry: RegistryPluginEntry; artifact: RegistryArtifact }

async function resolveSource(
  source: string,
  registryUrl: string | undefined,
  log: (msg: string) => void,
): Promise<ResolvedSource> {
  if (isGitUrl(source)) return { kind: 'git', url: source }

  const absPath = path.resolve(source)
  if (await isExistingDirectory(absPath)) return { kind: 'local', dir: absPath }

  log(`Looking up "${source}" in registry…`)
  const entry = await getPlugin(source, registryUrl ? { registryUrl } : {})
  if (!entry) {
    throw new Error(
      `"${source}" is not a git URL, an existing local directory, or a known plugin id`,
    )
  }

  if (entry.artifacts && entry.artifacts.length > 0) {
    const artifact = selectArtifact(entry.artifacts)
    if (!artifact) {
      const platform = describeCurrentPlatform()
      throw new UnsupportedPlatformError(
        `Plugin "${source}" has no artifact for ${platform.os}/${platform.cpu}` +
          (platform.libc ? `/${platform.libc}` : ''),
      )
    }
    return { kind: 'artifact', entry, artifact }
  }

  if (!entry.repository) {
    throw new Error(
      `Plugin "${source}" has no install artifacts and no repository URL`,
    )
  }
  return { kind: 'git', url: entry.repository }
}

export async function installPlugin(options: InstallOptions): Promise<PluginManifest> {
  const { source, registryUrl, onProgress } = options
  const log = (msg: string) => onProgress?.(msg)

  await fs.mkdir(PLUGINS_DIR, { recursive: true })

  const resolved = await resolveSource(source, registryUrl, log)

  if (resolved.kind === 'artifact') {
    return installFromArtifact(resolved.entry, resolved.artifact, log)
  }

  // Legacy paths: git clone or local source directory.
  let stagingDir: string
  if (resolved.kind === 'git') {
    const repoName = resolved.url.split('/').pop()?.replace(/\.git$/, '') ?? 'unknown'
    stagingDir = path.join(PLUGINS_DIR, `_tmp_${repoName}_${Date.now()}`)
    log(`Cloning ${resolved.url}…`)
    await execFileAsync('git', ['clone', '--depth', '1', resolved.url, stagingDir])
    log('Clone complete.')
  } else {
    stagingDir = resolved.dir
  }

  const manifest = await readAndValidateManifest(stagingDir)
  log(`Manifest validated: ${manifest.id}@${manifest.version}`)

  const finalDir = path.join(PLUGINS_DIR, manifest.id)
  if (stagingDir !== finalDir) {
    await atomicReplaceDir(stagingDir, finalDir)
  }

  await upsertRegistry(manifest)
  log(`Installed ${manifest.id}@${manifest.version}`)
  return manifest
}

async function installFromArtifact(
  entry: RegistryPluginEntry,
  artifact: RegistryArtifact,
  log: (msg: string) => void,
): Promise<PluginManifest> {
  const downloadPath = path.join(
    PLUGINS_DIR,
    `_dl_${entry.id}_${Date.now()}.tgz`,
  )
  const stagingDir = path.join(
    PLUGINS_DIR,
    `_tmp_${entry.id}_${Date.now()}`,
  )

  try {
    log(`Downloading artifact ${artifact.url}…`)
    await downloadArtifact(artifact.url, downloadPath)

    log('Verifying integrity…')
    await verifyIntegrity(downloadPath, artifact.integrity)

    log('Unpacking…')
    await unpackArtifact(downloadPath, stagingDir)

    const manifest = await readAndValidateManifest(stagingDir)
    if (manifest.id !== entry.id) {
      throw new Error(
        `Manifest id "${manifest.id}" does not match registry id "${entry.id}"`,
      )
    }
    log(`Manifest validated: ${manifest.id}@${manifest.version}`)

    const finalDir = path.join(PLUGINS_DIR, manifest.id)
    await atomicReplaceDir(stagingDir, finalDir)

    await upsertRegistry(manifest)
    log(`Installed ${manifest.id}@${manifest.version}`)
    return manifest
  } catch (err) {
    await fs.rm(stagingDir, { recursive: true, force: true })
    throw err
  } finally {
    await fs.rm(downloadPath, { force: true }).catch(() => {})
  }
}

/**
 * Replace `finalDir` with the contents of `stagingDir` while keeping the
 * previous installation intact if anything fails. The previous version is
 * moved to `<finalDir>.old` first; if the second rename fails, it is rolled
 * back. Both paths must live on the same filesystem (callers stage under
 * `PLUGINS_DIR` to ensure this).
 */
async function atomicReplaceDir(stagingDir: string, finalDir: string): Promise<void> {
  const backupDir = `${finalDir}.old`
  await fs.rm(backupDir, { recursive: true, force: true })

  const hadPrevious = await isExistingDirectory(finalDir)
  if (hadPrevious) {
    await fs.rename(finalDir, backupDir)
  }

  try {
    await fs.rename(stagingDir, finalDir)
  } catch (err) {
    if (hadPrevious) {
      await fs.rename(backupDir, finalDir).catch(() => {})
    }
    throw err
  }

  if (hadPrevious) {
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {})
  }
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

  const obj = parsed as Record<string, unknown>
  if (obj.entry !== undefined) {
    throw new Error(
      `nodal.json uses deprecated "entry" field — rename to "main" (SDK >= 0.2.0)`,
    )
  }
  if (obj.settingsSchema !== undefined) {
    throw new Error(
      `nodal.json uses deprecated "settingsSchema" field — move to "contributes.configuration.properties" (SDK >= 0.2.0)`,
    )
  }

  const manifest = parsed as PluginManifest
  if (manifest.type === 'device-bridge' && !manifest.main) {
    throw new Error(`nodal.json: device-bridge plugins must declare a "main" field`)
  }
  if (manifest.type === 'standalone-tool' && !manifest.executable) {
    throw new Error(`nodal.json: standalone-tool plugins must declare an "executable" field`)
  }

  return manifest
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

export async function reconcileRegistry(): Promise<void> {
  const registry = await readRegistry()
  let changed = false

  for (const pluginId of Object.keys(registry)) {
    const pluginDir = path.join(PLUGINS_DIR, pluginId)
    const exists = await isExistingDirectory(pluginDir)
    if (!exists) {
      delete registry[pluginId]
      changed = true
    }
  }

  if (changed) {
    await writeRegistry(registry)
  }
}

export async function getInstalledPlugin(pluginId: string): Promise<RegistryEntry | undefined> {
  const registry = await readRegistry()
  return registry[pluginId]
}

export { PLUGINS_DIR }
