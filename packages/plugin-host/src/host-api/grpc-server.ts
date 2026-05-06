import { writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import { HOST_API_PROTO_TEXT } from '@nodalcore/sdk'
import { dispatchHostRequest } from '../broker.js'

interface HostRequestMsg {
  plugin_id: string
  method: string
  args_json: string
}

interface HostResponseMsg {
  result_json: string
  error: string
}

let cachedProtoPath: string | null = null

function materializeProto(): string {
  if (cachedProtoPath && existsSync(cachedProtoPath)) return cachedProtoPath
  const dir = mkdtempSync(path.join(tmpdir(), 'nodalcore-host-proto-'))
  const file = path.join(dir, 'host_api.proto')
  writeFileSync(file, HOST_API_PROTO_TEXT, 'utf8')
  cachedProtoPath = file
  return file
}

let cachedServiceDef: grpc.ServiceDefinition | null = null

function loadServiceDef(): grpc.ServiceDefinition {
  if (cachedServiceDef) return cachedServiceDef
  const def = loadSync(materializeProto(), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const root = grpc.loadPackageDefinition(def) as any
  cachedServiceDef = root.nodalcore.host.v1.HostAPI.service as grpc.ServiceDefinition
  return cachedServiceDef
}

export interface HostApiGrpcServer {
  port: number
  stop(): Promise<void>
}

/**
 * Start the host-side gRPC server that backs `createGrpcTransport`. Routes
 * inbound `HostAPI.Request` calls through the same `dispatchHostRequest`
 * broker the IPC loader uses, so both transports share one set of host
 * handlers.
 *
 * Binds to `127.0.0.1:0` (random port). Resolves once the server is listening
 * — callers can then pass the port to a spawned tool via env var.
 */
export async function startHostApiGrpcServer(opts?: {
  bindAddress?: string
}): Promise<HostApiGrpcServer> {
  const server = new grpc.Server()
  const service = loadServiceDef()

  server.addService(service, {
    Request: (
      call: grpc.ServerUnaryCall<HostRequestMsg, HostResponseMsg>,
      callback: grpc.sendUnaryData<HostResponseMsg>,
    ) => {
      const req = call.request
      void (async () => {
        try {
          const args = req.args_json ? JSON.parse(req.args_json) : null
          const result = await dispatchHostRequest(req.plugin_id, req.method, args)
          callback(null, {
            result_json: result === undefined ? '' : JSON.stringify(result),
            error: '',
          })
        } catch (err) {
          callback(null, {
            result_json: '',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })()
    },
  })

  const address = `${opts?.bindAddress ?? '127.0.0.1'}:0`
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) reject(err)
      else resolve(boundPort)
    })
  })

  return {
    port,
    stop() {
      return new Promise<void>((resolve) => {
        server.tryShutdown((err) => {
          if (err) server.forceShutdown()
          resolve()
        })
      })
    },
  }
}
