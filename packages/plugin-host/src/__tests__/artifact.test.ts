import { describe, it, expect } from 'vitest'
import type { RegistryArtifact } from '@nodalcore/registry-client'
import {
  selectArtifact,
  UnsupportedPlatformError,
  type PlatformDescriptor,
} from '../artifact.js'

const linuxX64: PlatformDescriptor = {
  os: 'linux',
  cpu: 'x64',
  libc: 'glibc',
  nodeVersion: '20.10.0',
}

const darwinArm64: PlatformDescriptor = {
  os: 'darwin',
  cpu: 'arm64',
  nodeVersion: '20.10.0',
}

const universal = (overrides: Partial<RegistryArtifact> = {}): RegistryArtifact => ({
  url: 'https://example.com/universal.tgz',
  integrity: 'sha256:universal',
  ...overrides,
})

const explicit = (
  os: NonNullable<RegistryArtifact['os']>,
  cpu: NonNullable<RegistryArtifact['cpu']>,
  overrides: Partial<RegistryArtifact> = {},
): RegistryArtifact => ({
  url: `https://example.com/${os}-${cpu}.tgz`,
  integrity: `sha256:${os}-${cpu}`,
  os,
  cpu,
  ...overrides,
})

describe('selectArtifact — universal (no os/cpu)', () => {
  it('matches an artifact with no os/cpu on any platform', () => {
    const picked = selectArtifact([universal()], linuxX64)
    expect(picked?.url).toBe('https://example.com/universal.tgz')
  })

  it('matches an artifact with only os omitted (cpu still constrained)', () => {
    const picked = selectArtifact([universal({ cpu: 'x64' })], linuxX64)
    expect(picked).toBeDefined()
  })

  it('does not match when only cpu is omitted but os mismatches', () => {
    const picked = selectArtifact([universal({ os: 'win32' })], linuxX64)
    expect(picked).toBeUndefined()
  })
})

describe('selectArtifact — scoring', () => {
  it('prefers an explicit os+cpu artifact over a universal one', () => {
    const picked = selectArtifact(
      [universal(), explicit('linux', 'x64')],
      linuxX64,
    )
    expect(picked?.url).toBe('https://example.com/linux-x64.tgz')
  })

  it('prefers explicit os+cpu+libc+nodeRange over a universal one', () => {
    const picked = selectArtifact(
      [
        universal(),
        explicit('linux', 'x64', { libc: 'glibc', nodeRange: '>=20' }),
      ],
      linuxX64,
    )
    expect(picked?.libc).toBe('glibc')
  })

  it('falls back to a universal artifact when no platform-specific one matches', () => {
    const picked = selectArtifact(
      [universal(), explicit('win32', 'x64')],
      linuxX64,
    )
    expect(picked?.url).toBe('https://example.com/universal.tgz')
  })
})

describe('selectArtifact — libc / nodeRange (unchanged behavior)', () => {
  it('throws UnsupportedPlatformError when os/cpu match but libc rejects', () => {
    expect(() =>
      selectArtifact(
        [explicit('linux', 'x64', { libc: 'musl' })],
        linuxX64,
      ),
    ).toThrow(UnsupportedPlatformError)
  })

  it('throws UnsupportedPlatformError when nodeRange rejects every candidate', () => {
    expect(() =>
      selectArtifact(
        [explicit('linux', 'x64', { nodeRange: '>=22' })],
        linuxX64,
      ),
    ).toThrow(UnsupportedPlatformError)
  })

  it('ignores libc on non-Linux platforms', () => {
    const picked = selectArtifact(
      [explicit('darwin', 'arm64', { libc: 'glibc' })],
      darwinArm64,
    )
    expect(picked).toBeDefined()
  })
})

describe('selectArtifact — empty / no-match', () => {
  it('returns undefined for an empty array', () => {
    expect(selectArtifact([], linuxX64)).toBeUndefined()
  })

  it('returns undefined when every artifact has explicit mismatching os/cpu', () => {
    const picked = selectArtifact(
      [explicit('win32', 'x64'), explicit('darwin', 'arm64')],
      linuxX64,
    )
    expect(picked).toBeUndefined()
  })
})
