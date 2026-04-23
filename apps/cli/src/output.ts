/**
 * Output formatter for the NodalCore CLI.
 *
 * - TTY (interactive terminal): human-readable table/text
 * - Non-TTY (piped, MCP, AI agent): JSONL (one JSON object per line)
 */

export function isTTY(): boolean {
  return process.stdout.isTTY === true
}

export function formatResult(data: unknown): string {
  if (Array.isArray(data)) {
    return formatTable(data)
  }
  if (typeof data === 'object' && data !== null) {
    return formatKeyValue(data as Record<string, unknown>)
  }
  return String(data)
}

export function formatError(code: string, message: string): string {
  return `\x1b[31mError [${code}]:\x1b[0m ${message}`
}

export function formatProgress(step: string, pct?: number): string {
  const bar = pct !== undefined ? ` [${pct}%]` : ''
  return `\x1b[33m⏳\x1b[0m ${step}${bar}`
}

function formatTable(rows: unknown[]): string {
  if (rows.length === 0) return '(empty)'
  const first = rows[0] as Record<string, unknown>
  const keys = Object.keys(first)
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String((r as Record<string, unknown>)[k] ?? '').length)),
  )
  const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ')
  const separator = widths.map((w) => '─'.repeat(w)).join('──')
  const body = rows
    .map((row) =>
      keys.map((k, i) => String((row as Record<string, unknown>)[k] ?? '').padEnd(widths[i])).join('  '),
    )
    .join('\n')
  return `${header}\n${separator}\n${body}`
}

function formatKeyValue(obj: Record<string, unknown>): string {
  const maxKeyLen = Math.max(...Object.keys(obj).map((k) => k.length))
  return Object.entries(obj)
    .map(([k, v]) => `${k.padEnd(maxKeyLen)}  ${String(v)}`)
    .join('\n')
}
