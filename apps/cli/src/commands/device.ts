import { Command } from 'commander'
import { loadDevicePlugin } from '@nodalcore/plugin-host'
import { printResult, printError, printProgress } from '../helpers.js'

const activeSessions = new Map<string, Awaited<ReturnType<typeof loadDevicePlugin>>>()

export function registerDeviceCommands(program: Command): void {
  const device = program.command('device').description('Manage device connections')

  device
    .command('connect <plugin-id>')
    .description('Connect to a device via its plugin')
    .option('--port <port>', 'Serial/TCP port or address')
    .option('--baud <baud>', 'Serial baud rate', '9600')
    .option('--host <host>', 'TCP/MQTT host')
    .option('--tcp-port <tcpPort>', 'TCP port number')
    .option('--topic <topic>', 'MQTT topic')
    .action(async (pluginId: string, opts: Record<string, string>) => {
      try {
        printProgress(`Loading plugin ${pluginId}...`)
        const pluginProxy = await loadDevicePlugin(pluginId)

        const connectionOpts = buildConnectionOpts(opts)
        printProgress('Connecting...')
        await pluginProxy.connect(connectionOpts)

        activeSessions.set(pluginId, pluginProxy)
        printResult({ pluginId, connected: true })
      } catch (err) {
        printError('CONNECT_FAILED', String(err))
      }
    })

  device
    .command('disconnect <plugin-id>')
    .description('Disconnect from a device')
    .action(async (pluginId: string) => {
      try {
        const session = activeSessions.get(pluginId)
        if (!session) {
          printError('NOT_CONNECTED', `No active session for ${pluginId}`)
          return
        }
        await session.disconnect()
        activeSessions.delete(pluginId)
        printResult({ pluginId, disconnected: true })
      } catch (err) {
        printError('DISCONNECT_FAILED', String(err))
      }
    })
}

function buildConnectionOpts(opts: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (opts.port) result.path = opts.port
  if (opts.baud) result.baudRate = Number(opts.baud)
  if (opts.host) result.host = opts.host
  if (opts.tcpPort) result.port = Number(opts.tcpPort)
  if (opts.topic) result.topic = opts.topic
  return result
}

export { activeSessions }
