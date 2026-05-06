import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { PLUGINS_DIR, readAndValidateManifest } from './installer.js'
import type { PluginManifest } from '@nodalcore/sdk'
import { registerHostApiHandlers } from './host-api/server.js'
import { startHostApiGrpcServer, type HostApiGrpcServer } from './host-api/grpc-server.js'

interface SpawnedTool {
  pluginId: string
  manifest: PluginManifest
  process: ChildProcess
  /** gRPC port the tool is listening on (parsed from stdout) */
  port: number
  /** Host-side HostAPI gRPC server dedicated to this tool */
  hostServer: HostApiGrpcServer
}

const running = new Map<string, SpawnedTool>()

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])

function resolveLaunchCommand(execPath: string): [string, string[]] {
  if (JS_EXTENSIONS.has(path.extname(execPath).toLowerCase())) {
    return [process.execPath, [execPath]]
  }
  return [execPath, []]
}

/**
 * Spawn a standalone-tool plugin executable.
 *
 * Sequence:
 *   1. Start the host's HostAPI gRPC server on a random localhost port.
 *   2. Pass that port via `NODALCORE_HOST_PORT` so the tool can dial in
 *      *before* it activates and prints `NODALCORE_READY`. Two channels
 *      (host→tool, tool→host) are alive throughout activation.
 *   3. Wait for the tool to print `NODALCORE_READY <port>` on stdout
 *      (10s timeout) — its own gRPC service port.
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

  registerHostApiHandlers()
  const hostServer = await startHostApiGrpcServer()

  const execPath = path.resolve(pluginDir, manifest.executable)
  const [command, args] = resolveLaunchCommand(execPath)

  const child = spawn(command, args, {
    cwd: pluginDir,
    env: {
      ...process.env,
      NODALCORE_PLUGIN_ID: pluginId,
      NODALCORE_PLUGIN_DIR: pluginDir,
      NODALCORE_HOST_PORT: String(hostServer.port),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let port: number
  try {
    port = await waitForReady(child, pluginId)
  } catch (err) {
    await hostServer.stop().catch(() => {})
    throw err
  }

  const tool: SpawnedTool = { pluginId, manifest, process: child, port, hostServer }
  running.set(pluginId, tool)

  child.on('exit', () => {
    running.delete(pluginId)
    void hostServer.stop().catch(() => {})
  })

  return tool
}

export async function stopTool(pluginId: string): Promise<void> {
  const tool = running.get(pluginId)
  if (!tool) return
  tool.process.kill('SIGTERM')
  await tool.hostServer.stop().catch(() => {})
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
