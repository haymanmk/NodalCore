import * as readline from 'node:readline'
import {
  listInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  loadDevicePlugin,
  getConfiguration,
  setConfiguration,
  getInstalledPlugin,
} from '@nodalcore/plugin-host'
import { searchPlugins } from '@nodalcore/registry-client'
import type { ConnectionOptions } from '@nodalcore/sdk'

interface ReplState {
  activePlugin: Awaited<ReturnType<typeof loadDevicePlugin>> | null
  activePluginId: string | null
}

const state: ReplState = { activePlugin: null, activePluginId: null }

const HELP = `
Available commands:
  plugins list                  List installed plugins
  plugins search <query>        Search registry
  plugins install <id-or-url>   Install a plugin
  plugins uninstall <id>        Uninstall a plugin
  connect <plugin-id>           Connect to a device plugin
  disconnect                    Disconnect current plugin
  settings get                  Read settings of connected plugin
  settings set <key> <value>    Write a setting
  settings schema               Show settings JSON Schema
  status                        Show current session state
  help                          Show this help
  exit                          Exit REPL
`.trim()

export async function startRepl(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'nodalcore> ',
  })

  console.log('NodalCore REPL — type "help" for commands')
  rl.prompt()

  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/)
    const cmd = parts[0]

    try {
      switch (cmd) {
        case 'help':
          console.log(HELP)
          break

        case 'status':
          console.log(
            state.activePluginId
              ? `Connected to: ${state.activePluginId}`
              : 'No active connection',
          )
          break

        case 'plugins':
          await handlePlugins(parts.slice(1))
          break

        case 'connect':
          await handleConnect(parts[1])
          break

        case 'disconnect':
          await handleDisconnect()
          break

        case 'settings':
          await handleSettings(parts.slice(1))
          break

        case 'exit':
        case 'quit':
          if (state.activePlugin) {
            await state.activePlugin.disconnect()
          }
          rl.close()
          return

        case '':
        case undefined:
          break

        default:
          console.log(`Unknown command: ${cmd}. Type "help" for commands.`)
      }
    } catch (err) {
      console.error(`Error: ${err}`)
    }

    rl.prompt()
  })

  rl.on('close', () => {
    process.exit(0)
  })
}

async function handlePlugins(args: string[]): Promise<void> {
  const sub = args[0]
  switch (sub) {
    case 'list': {
      const plugins = await listInstalledPlugins()
      for (const p of plugins) {
        console.log(`  ${p.manifest.id} (${p.manifest.version}) [${p.manifest.type}] — ${p.status}`)
      }
      if (plugins.length === 0) console.log('  No plugins installed.')
      break
    }
    case 'search': {
      const query = args.slice(1).join(' ')
      if (!query) {
        console.log('Usage: plugins search <query>')
        return
      }
      const results = await searchPlugins({ query })
      for (const r of results) {
        console.log(`  ${r.id} — ${r.name}: ${r.description}`)
      }
      if (results.length === 0) console.log('  No results.')
      break
    }
    case 'install': {
      const source = args[1]
      if (!source) {
        console.log('Usage: plugins install <id-or-url>')
        return
      }
      const manifest = await installPlugin({
        source,
        onProgress: (msg) => console.log(`  ${msg}`),
      })
      console.log(`  Installed ${manifest.name} (${manifest.version})`)
      break
    }
    case 'uninstall': {
      const id = args[1]
      if (!id) {
        console.log('Usage: plugins uninstall <id>')
        return
      }
      await uninstallPlugin(id)
      console.log(`  Uninstalled ${id}`)
      break
    }
    default:
      console.log('Usage: plugins [list|search|install|uninstall]')
  }
}

async function handleConnect(pluginId: string | undefined): Promise<void> {
  if (!pluginId) {
    console.log('Usage: connect <plugin-id>')
    return
  }
  if (state.activePlugin) {
    console.log(`Already connected to ${state.activePluginId}. Disconnect first.`)
    return
  }
  console.log(`Loading ${pluginId}...`)
  const proxy = await loadDevicePlugin(pluginId)
  await proxy.connect({} as ConnectionOptions)
  state.activePlugin = proxy
  state.activePluginId = pluginId
  console.log(`Connected to ${pluginId}`)
}

async function handleDisconnect(): Promise<void> {
  if (!state.activePlugin) {
    console.log('No active connection.')
    return
  }
  await state.activePlugin.disconnect()
  console.log(`Disconnected from ${state.activePluginId}`)
  state.activePlugin = null
  state.activePluginId = null
}

async function handleSettings(args: string[]): Promise<void> {
  if (!state.activePluginId) {
    console.log('No active plugin. Connect to one first.')
    return
  }
  const pluginId = state.activePluginId
  const sub = args[0]
  switch (sub) {
    case 'get': {
      const values = await getConfiguration(pluginId)
      console.log(JSON.stringify(values, null, 2))
      break
    }
    case 'set': {
      const key = args[1]
      const raw = args.slice(2).join(' ')
      if (!key || !raw) {
        console.log('Usage: settings set <key> <value>')
        return
      }
      let parsed: unknown = raw
      try { parsed = JSON.parse(raw) } catch { /* keep as string */ }
      await setConfiguration(pluginId, { [key]: parsed })
      console.log(`  ${key} = ${JSON.stringify(parsed)}`)
      break
    }
    case 'schema': {
      const entry = await getInstalledPlugin(pluginId)
      const cfg = entry?.manifest.contributes?.configuration
      if (!cfg) {
        console.log('  Plugin declares no contributes.configuration')
        return
      }
      console.log(JSON.stringify({ type: 'object', title: cfg.title, properties: cfg.properties }, null, 2))
      break
    }
    default:
      console.log('Usage: settings [get|set|schema]')
  }
}
