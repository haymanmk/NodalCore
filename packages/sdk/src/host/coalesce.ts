/**
 * Returns a wrapper that calls `fn` with the most recent arguments at most once
 * per `intervalMs`, dropping intermediate updates. Suitable for high-rate
 * sensor streams where only the latest value matters.
 */
export function coalesceLastWins<T extends unknown[]>(
  fn: (...args: T) => void,
  intervalMs: number,
): (...args: T) => void {
  let lastArgs: T | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  return (...args: T) => {
    lastArgs = args
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      const pending = lastArgs
      lastArgs = null
      if (pending) fn(...pending)
    }, intervalMs)
  }
}
