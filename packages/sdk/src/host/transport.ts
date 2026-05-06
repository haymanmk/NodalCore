export type RequestHandler = (args: unknown) => unknown | Promise<unknown>

export interface Transport {
  /** Send a request to the peer and await its response. */
  request(method: string, args: unknown): Promise<unknown>
  /** Register a handler invoked when the peer sends a request with this method name. */
  onRequest(method: string, handler: RequestHandler): void
}
