#!/usr/bin/env node

/**
 * Standalone tool executable.
 * On startup it opens a gRPC server and prints the ready signal
 * so the plugin-host spawner can discover the port.
 */

import * as http from 'node:http'

const PORT = 0 // let OS pick a free port

const server = http.createServer((_req, res) => {
  // Simple health endpoint — a real tool would use gRPC via @connectrpc
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ status: 'ok', tool: 'example-image-processor' }))
})

server.listen(PORT, () => {
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : PORT
  // This is the signal the spawner watches for
  process.stdout.write(`NODALCORE_READY ${port}\n`)
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
