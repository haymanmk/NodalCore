import { writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import type { Transport, RequestHandler } from './transport.js'
import { HOST_API_PROTO_TEXT } from '../proto/host-api-text.js'

interface HostRequest {
  plugin_id: string
  method: string
  args_json: string
}

interface HostResponse {
  result_json: string
  error: string
}

interface HostApiClient extends grpc.Client {
  Request(
    req: HostRequest,
    deadline: grpc.CallOptions,
    cb: (err: grpc.ServiceError | null, res?: HostResponse) => void,
  ): void
}

interface HostApiCtor {
  new (address: string, creds: grpc.ChannelCredentials): HostApiClient
}

let cachedProtoPath: string | null = null

/**
 * proto-loader requires a filesystem path. Materialize the embedded proto
 * text into a temp file once per process and cache the path. This makes the
 * SDK bundleable — the proto travels inside the bundle as a string constant.
 */
function materializeProto(): string {
  if (cachedProtoPath && existsSync(cachedProtoPath)) return cachedProtoPath
  const dir = mkdtempSync(path.join(tmpdir(), 'nodalcore-sdk-proto-'))
  const file = path.join(dir, 'host_api.proto')
  writeFileSync(file, HOST_API_PROTO_TEXT, 'utf8')
  cachedProtoPath = file
  return file
}

let cachedClientCtor: HostApiCtor | null = null

function loadClientCtor(): HostApiCtor {
  if (cachedClientCtor) return cachedClientCtor
  const def = loadSync(materializeProto(), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const root = grpc.loadPackageDefinition(def) as any
  cachedClientCtor = root.nodalcore.host.v1.HostAPI as HostApiCtor
  return cachedClientCtor
}

/**
 * Create a Transport that calls the host's gRPC HostAPI service. Standalone-tool
 * plugins use this to invoke `host.window.*` / `host.workspace.*` over a separate
 * channel from the tool's own gRPC service. Inbound (host → tool) requests
 * travel over the tool's own service and are NOT routed through this transport;
 * `onRequest` therefore throws — host → standalone direction is delivered via
 * the tool's own RPC surface today.
 */
export function createGrpcTransport(opts: {
  hostPort: number
  pluginId: string
  hostAddress?: string
  deadlineMs?: number
}): Transport {
  const ClientCtor = loadClientCtor()
  const address = `${opts.hostAddress ?? '127.0.0.1'}:${opts.hostPort}`
  const client = new ClientCtor(address, grpc.credentials.createInsecure())
  const deadlineMs = opts.deadlineMs ?? 30_000

  return {
    request(method, args) {
      return new Promise((resolve, reject) => {
        const deadline = new Date(Date.now() + deadlineMs)
        client.Request(
          {
            plugin_id: opts.pluginId,
            method,
            args_json: JSON.stringify(args ?? null),
          },
          { deadline },
          (err, res) => {
            if (err) {
              reject(err)
              return
            }
            if (!res) {
              reject(new Error(`Empty response from host for ${method}`))
              return
            }
            if (res.error) {
              reject(new Error(res.error))
              return
            }
            try {
              resolve(res.result_json ? JSON.parse(res.result_json) : null)
            } catch (parseErr) {
              reject(parseErr instanceof Error ? parseErr : new Error(String(parseErr)))
            }
          },
        )
      })
    },
    onRequest(_method: string, _handler: RequestHandler) {
      throw new Error(
        'createGrpcTransport: host → tool requests are not routed through this transport. ' +
          'Implement them on the tool\'s own gRPC service.',
      )
    },
  }
}
