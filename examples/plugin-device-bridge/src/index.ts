import type { ConnectionOptions, ExtensionContext } from '@nodalcore/sdk'
import { DevicePlugin } from '@nodalcore/sdk'

export default class MultimeterPlugin extends DevicePlugin {
  readonly connectionType = 'serial' as const

  private connected = false

  async connect(options: ConnectionOptions): Promise<void> {
    console.log('[MultimeterPlugin] Connecting via serial...', options)
    this.connected = true
    console.log('[MultimeterPlugin] Connected.')
  }

  async disconnect(): Promise<void> {
    console.log('[MultimeterPlugin] Disconnecting...')
    this.connected = false
  }
}

function fakeReading(unit: string): { unit: string; value: number; timestamp: number } {
  // Deterministic-ish jitter so the panel sees motion without a real device.
  const base = unit === 'V' ? 5 : unit === 'mV' ? 2300 : unit === 'A' ? 0.42 : 12
  const value = +(base + Math.sin(Date.now() / 800) * base * 0.05).toFixed(3)
  return { unit, value, timestamp: Date.now() }
}

export async function activate(ctx: ExtensionContext): Promise<void> {
  let unit = ((await ctx.workspace.getConfiguration()).unit as string | undefined) ?? 'V'
  await ctx.window.showMessage(`Multimeter activated (unit: ${unit})`)

  // Re-read on every settings change pushed by the host. Without this the
  // captured `unit` would stay stale forever — the user could change the
  // unit on the Installed page and the readings would keep using the old one.
  ctx.workspace.onDidChangeConfiguration((cfg) => {
    unit = (cfg.unit as string | undefined) ?? 'V'
  })

  // Webview → plugin: the panel can ask for the current reading.
  ctx.views.onMessage('readout', (data) => {
    if ((data as { type?: string } | null)?.type === 'measure') {
      return fakeReading(unit)
    }
    return { ok: true }
  })

  // Plugin → webview: emit a fresh reading every second. If the panel isn't
  // open, the host returns false and we just keep ticking.
  setInterval(() => {
    void ctx.views.postMessage('readout', fakeReading(unit)).catch(() => {})
  }, 1000)
}

export async function deactivate(): Promise<void> {
  console.log('[MultimeterPlugin] deactivate')
}
