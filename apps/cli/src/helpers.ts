import { isTTY, formatResult, formatError, formatProgress } from './output.js'

type OutputType = 'result' | 'error' | 'progress'

interface OutputMessage {
  type: OutputType
  [key: string]: unknown
}

/** Print a result to stdout in the correct format. */
export function printResult(data: unknown): void {
  if (isTTY()) {
    console.log(formatResult(data))
  } else {
    const msg: OutputMessage = { type: 'result', data }
    console.log(JSON.stringify(msg))
  }
}

/** Print an error to stderr in the correct format. */
export function printError(code: string, message: string): void {
  if (isTTY()) {
    console.error(formatError(code, message))
  } else {
    const msg: OutputMessage = { type: 'error', code, message }
    console.error(JSON.stringify(msg))
  }
}

/** Print a progress update to stdout in the correct format. */
export function printProgress(step: string, pct?: number): void {
  if (isTTY()) {
    console.log(formatProgress(step, pct))
  } else {
    const msg: OutputMessage = { type: 'progress', step, pct }
    console.log(JSON.stringify(msg))
  }
}
