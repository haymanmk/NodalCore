import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { PLUGINS_DIR, readAndValidateManifest } from './installer.js'
import type { PluginManifest } from '@nodalcore/sdk'

interface SpawnedTool {
  pluginId: string
  manifest: PluginManifest
  process: ChildProcess
  /** gRPC port the tool is listening on (parsed from stdout) */
  port: number
}

const running = new Map<string, SpawnedTool>()

/**
 * Spawn a standalone-tool plugin executable.
 * The executable must print a single line to stdout in the format:
 *   NODALCORE_READY <port>
 * within 10 seconds, signalling that its gRPC server is up.
 */
export async function spawnTool(pluginId: string): Promise<SpawnedTool> {
  const pluginDir = path.join(PLUGINS_DIR, pluginId)
  const manifest = await readAndValidateManifest(pluginDir)

  if (manifest.type !== 'standalone-tool') {
    throw new Error(`Plugin ${pluginId} is not a standalone-tool plugin`)
  }
  if (!manifest.executable) {
    throw new Error(`Plugin ${pluginId} has no executable field in nodal.json`)
  }

  const execPath = path.resolve(pluginDir, manifest.executable)

  const child = spawn(execPath, [], {
    env: {
      ...process.env,
      NODALCORE_PLUGIN_ID: pluginId,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const port = await waitForReady(child, pluginId)

  const tool: SpawnedTool = { pluginId, manifest, process: child, port }
  running.set(pluginId, tool)

  child.on('exit', () => running.delete(pluginId))

  return tool
}

export async function stopTool(pluginId: string): Promise<void> {
  const tool = running.get(pluginId)
  if (!tool) return
  tool.process.kill('SIGTERM')
  running.delete(pluginId)
}

export function getRunningTool(pluginId: string): SpawnedTool | undefined {
  return running.get(pluginId)
}

export function listRunningTools(): SpawnedTool[] {
  return Array.from(running.values())
}

function waitForReady(child: ChildProcess, pluginId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Plugin ${pluginId} did not signal NODALCORE_READY within 10s`))
    }, 10_000)

    let buffer = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const match = buffer.match(/NODALCORE_READY (\d+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(parseInt(match[1], 10))
      }
    })

    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Plugin ${pluginId} exited with code ${code} before signalling ready`))
    })
  })
}
