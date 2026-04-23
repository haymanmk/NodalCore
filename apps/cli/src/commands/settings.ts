import { Command } from 'commander'
import { activeSessions } from './device.js'
import { printResult, printError } from '../helpers.js'

export function registerSettingsCommands(program: Command): void {
  const settings = program.command('settings').description('Read and write plugin settings')

  settings
    .command('get <plugin-id>')
    .description('Read current settings of a connected plugin')
    .action(async (pluginId: string) => {
      try {
        const session = activeSessions.get(pluginId)
        if (!session) {
          printError('NOT_CONNECTED', `No active session for ${pluginId}`)
          return
        }
        const values = await session.readSettings()
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
        const session = activeSessions.get(pluginId)
        if (!session) {
          printError('NOT_CONNECTED', `No active session for ${pluginId}`)
          return
        }
        const parsed = tryParse(value)
        await session.writeSettings({ [key]: parsed })
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
        const session = activeSessions.get(pluginId)
        if (!session) {
          printError('NOT_CONNECTED', `No active session for ${pluginId}`)
          return
        }
        const schema = await session.getSettingsSchema()
        printResult(schema)
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
