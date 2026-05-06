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

export async function activate(ctx: ExtensionContext): Promise<void> {
  const config = await ctx.workspace.getConfiguration()
  const unit = (config.unit as string | undefined) ?? 'V'
  await ctx.window.showMessage(`Multimeter activated (unit: ${unit})`)
}

export async function deactivate(): Promise<void> {
  console.log('[MultimeterPlugin] deactivate')
}
