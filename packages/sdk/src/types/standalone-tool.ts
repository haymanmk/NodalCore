/**
 * Interface that every standalone-tool plugin can implement.
 *
 * A standalone tool is an independent process (any language) that communicates
 * with NodalCore over the Connect/gRPC protocol. The plugin-host spawns the
 * executable and connects to it as a gRPC client.
 *
 * Tools also dial back to the host's gRPC HostAPI (port supplied via the
 * NODALCORE_HOST_PORT env var) so they can call `host.window.showMessage` etc.
 * Settings are read from the host configuration store, not held inside the tool.
 *
 * @example
 * ```ts
 * import { StandaloneTool } from '@nodalcore/sdk'
 *
 * export default class MyTool implements StandaloneTool {
 *   async launch() { ... }
 *   async shutdown() { ... }
 *   getProtoDefinition() { return fs.readFileSync('./my-tool.proto', 'utf8') }
 * }
 * ```
 */
export interface StandaloneTool {
  /** Spawn the tool process and wait until it signals readiness. */
  launch(): Promise<void>

  /** Gracefully terminate the tool process. */
  shutdown(): Promise<void>

  /**
   * Return the raw .proto file content (as a UTF-8 string) that describes
   * the gRPC services this tool exposes. NodalCore uses this to build a
   * typed client at runtime.
   */
  getProtoDefinition(): string
}
