import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'
import * as tar from 'tar'
import semver from 'semver'
import type { RegistryArtifact } from '@nodalcore/registry-client'

export class UnsupportedPlatformError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedPlatformError'
  }
}

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrityError'
  }
}

export interface PlatformDescriptor {
  os: NodeJS.Platform
  cpu: string
  libc?: 'glibc' | 'musl'
  nodeVersion: string
}

let cachedLibc: 'glibc' | 'musl' | undefined
let libcDetected = false

function detectLibc(): 'glibc' | 'musl' | undefined {
  if (process.platform !== 'linux') return undefined
  if (libcDetected) return cachedLibc

  libcDetected = true

  type ReportHeader = { glibcVersionRuntime?: string }
  const report = (process as unknown as { report?: { getReport?: () => { header?: ReportHeader } } }).report
  const header = report?.getReport?.().header
  if (header?.glibcVersionRuntime) {
    cachedLibc = 'glibc'
    return cachedLibc
  }

  try {
    const out = execFileSync('ldd', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    cachedLibc = /musl/i.test(out) ? 'musl' : 'glibc'
  } catch {
    cachedLibc = 'glibc'
  }
  return cachedLibc
}

export function describeCurrentPlatform(): PlatformDescriptor {
  return {
    os: process.platform,
    cpu: process.arch,
    libc: detectLibc(),
    nodeVersion: process.versions.node,
  }
}

/**
 * Pick the best artifact for the given platform descriptor.
 * Returns `undefined` if no candidate matches OS/CPU; throws if candidates
 * exist for the OS/CPU but none satisfy libc / nodeRange constraints.
 */
export function selectArtifact(
  artifacts: RegistryArtifact[],
  platform: PlatformDescriptor = describeCurrentPlatform(),
): RegistryArtifact | undefined {
  const osCpuMatches = artifacts.filter(
    (a) => a.os === platform.os && a.cpu === platform.cpu,
  )
  if (osCpuMatches.length === 0) return undefined

  const libcMatches = osCpuMatches.filter((a) => {
    if (platform.os !== 'linux') return true
    if (!a.libc) return true
    return a.libc === platform.libc
  })

  const nodeMatches = libcMatches.filter((a) => {
    if (!a.nodeRange) return true
    return semver.satisfies(platform.nodeVersion, a.nodeRange, { includePrerelease: true })
  })

  if (nodeMatches.length === 0) {
    throw new UnsupportedPlatformError(
      `No registry artifact matches ${platform.os}/${platform.cpu}` +
        (platform.libc ? `/${platform.libc}` : '') +
        ` with Node ${platform.nodeVersion}`,
    )
  }

  // Prefer the most specific match (libc + nodeRange both set).
  const score = (a: RegistryArtifact) => (a.libc ? 1 : 0) + (a.nodeRange ? 1 : 0)
  return nodeMatches.slice().sort((a, b) => score(b) - score(a))[0]
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return `sha256:${hash.digest('hex')}`
}

export async function downloadArtifact(url: string, destPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Artifact download failed: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('Artifact download returned no body')
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destPath))
}

export async function verifyIntegrity(filePath: string, expected: string): Promise<void> {
  const actual = await hashFile(filePath)
  if (actual !== expected) {
    throw new IntegrityError(
      `Artifact integrity mismatch: expected ${expected}, got ${actual}`,
    )
  }
}

/** Extract a `.tgz` archive into a target directory. */
export async function unpackArtifact(tgzPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true })
  await tar.x({ file: tgzPath, cwd: destDir })
}

/** Create a fresh temporary directory under the OS tmp root. */
export async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}
