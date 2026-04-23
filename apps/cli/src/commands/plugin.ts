import { Command } from 'commander'
import { listInstalledPlugins, installPlugin, uninstallPlugin } from '@nodalcore/plugin-host'
import { searchPlugins } from '@nodalcore/registry-client'
import { printResult, printError, printProgress } from '../helpers.js'

export function registerPluginCommands(program: Command): void {
  const plugin = program.command('plugin').description('Manage plugins')

  plugin
    .command('list')
    .description('List installed plugins')
    .action(async () => {
      try {
        const plugins = await listInstalledPlugins()
        const rows = plugins.map((p) => ({
          id: p.manifest.id,
          name: p.manifest.name,
          version: p.manifest.version,
          type: p.manifest.type,
          status: p.status,
        }))
        printResult(rows)
      } catch (err) {
        printError('LIST_FAILED', String(err))
      }
    })

  plugin
    .command('search <query>')
    .description('Search the plugin registry')
    .option('-t, --type <type>', 'Filter by type (device-bridge | standalone-tool)')
    .action(async (query: string, opts: { type?: string }) => {
      try {
        const results = await searchPlugins({
          query,
          type: opts.type as 'device-bridge' | 'standalone-tool' | undefined,
        })
        const rows = results.map((p) => ({
          id: p.id,
          name: p.name,
          version: p.version,
          type: p.type,
          description: p.description,
        }))
        printResult(rows)
      } catch (err) {
        printError('SEARCH_FAILED', String(err))
      }
    })

  plugin
    .command('install <id-or-url>')
    .description('Install a plugin by id or git URL')
    .action(async (source: string) => {
      try {
        const manifest = await installPlugin({
          source,
          onProgress: (msg) => printProgress(msg),
        })
        printResult({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          installed: true,
        })
      } catch (err) {
        printError('INSTALL_FAILED', String(err))
      }
    })

  plugin
    .command('uninstall <id>')
    .description('Uninstall a plugin')
    .action(async (id: string) => {
      try {
        await uninstallPlugin(id)
        printResult({ id, uninstalled: true })
      } catch (err) {
        printError('UNINSTALL_FAILED', String(err))
      }
    })
}
