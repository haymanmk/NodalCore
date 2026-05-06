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
  const config = await ctx.workspace.getConfiguration()
  const unit = (config.unit as string | undefined) ?? 'V'
  await ctx.window.showMessage(`Multimeter activated (unit: ${unit})`)

  // Webview → plugin: the panel can ask for the current reading.
  ctx.views.onMessage('readout', async (data) => {
    const cfg = await ctx.workspace.getConfiguration()
    const u = (cfg.unit as string | undefined) ?? 'V'
    if ((data as { type?: string } | null)?.type === 'measure') {
      return fakeReading(u)
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
