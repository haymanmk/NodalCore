import { Command } from 'commander'
import {
  getConfiguration,
  setConfiguration,
  getInstalledPlugin,
} from '@nodalcore/plugin-host'
import { printResult, printError } from '../helpers.js'

export function registerSettingsCommands(program: Command): void {
  const settings = program.command('settings').description('Read and write plugin settings')

  settings
    .command('get <plugin-id>')
    .description('Read this plugin\'s persisted configuration')
    .action(async (pluginId: string) => {
      try {
        const values = await getConfiguration(pluginId)
        printResult(values)
      } catch (err) {
        printError('SETTINGS_READ_FAILED', String(err))
      }
    })

  settings
    .command('set <plugin-id> <key> <value>')
    .description('Write a setting value')
    .action(async (pluginId: string, key: string, value: string) => {
      try {
        const parsed = tryParse(value)
        await setConfiguration(pluginId, { [key]: parsed })
        printResult({ pluginId, key, value: parsed, updated: true })
      } catch (err) {
        printError('SETTINGS_WRITE_FAILED', String(err))
      }
    })

  settings
    .command('schema <plugin-id>')
    .description('Show the JSON Schema for plugin settings')
    .action(async (pluginId: string) => {
      try {
        const entry = await getInstalledPlugin(pluginId)
        if (!entry) {
          printError('NOT_INSTALLED', `Plugin ${pluginId} is not installed`)
          return
        }
        const cfg = entry.manifest.contributes?.configuration
        if (!cfg) {
          printError('NO_SCHEMA', `Plugin ${pluginId} declares no contributes.configuration`)
          return
        }
        printResult({ type: 'object', title: cfg.title, properties: cfg.properties })
      } catch (err) {
        printError('SCHEMA_FAILED', String(err))
      }
    })
}

function tryParse(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  const num = Number(value)
  if (!Number.isNaN(num) && value.trim() !== '') return num
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
