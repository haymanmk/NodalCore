import type { JSONSchema7 } from 'json-schema'

/**
 * Interface that every standalone-tool plugin must implement.
 *
 * A standalone tool is an independent process (any language) that communicates
 * with NodalCore over the Connect/gRPC protocol. The plugin-host spawns the
 * executable and connects to it as a gRPC client.
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

  /**
   * Optional: return the JSON Schema describing the tool's settings.
   * If omitted, the schema from nodal.json is used.
   */
  getSettingsSchema?(): JSONSchema7
}
