/**
 * Standalone tool executable.
 *
 * Activation sequence:
 *   1. Dial the host's gRPC HostAPI on `NODALCORE_HOST_PORT` and build
 *      an ExtensionContext.
 *   2. Run plugin activation logic (read config, show a toast, …) so the
 *      host sees a request before the tool is marked ready.
 *   3. Start the tool's own service and print `NODALCORE_READY <port>`
 *      so the spawner knows we're up.
 */

import * as http from 'node:http'
import { createGrpcTransport, createExtensionContext } from '@nodalcore/sdk'

const PLUGIN_ID = process.env.NODALCORE_PLUGIN_ID ?? 'example-image-processor'
const HOST_PORT = process.env.NODALCORE_HOST_PORT
  ? parseInt(process.env.NODALCORE_HOST_PORT, 10)
  : null

async function activate() {
  if (HOST_PORT === null || Number.isNaN(HOST_PORT)) {
    console.error('[tool] NODALCORE_HOST_PORT not set — running without host API')
    return
  }
  const transport = createGrpcTransport({ hostPort: HOST_PORT, pluginId: PLUGIN_ID })
  const ctx = createExtensionContext(transport, PLUGIN_ID)

  const cfg = await ctx.workspace.getConfiguration()
  const format = typeof cfg.outputFormat === 'string' ? cfg.outputFormat : 'png'
  await ctx.window.showMessage(`Image processor activated (format: ${format})`)
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ status: 'ok', tool: 'example-image-processor' }))
})

await activate().catch((err) => {
  console.error('[tool] activation failed:', err)
})

server.listen(0, () => {
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  process.stdout.write(`NODALCORE_READY ${port}\n`)
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
