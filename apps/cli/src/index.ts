#!/usr/bin/env node
import { Command } from 'commander'
import { registerPluginCommands } from './commands/plugin.js'
import { registerDeviceCommands } from './commands/device.js'
import { registerSettingsCommands } from './commands/settings.js'
import { startRepl } from './repl.js'
import { startMcpServer } from './mcp-server.js'

const program = new Command()

program
  .name('nodalcore')
  .description('NodalCore CLI — manage plugins, devices, and settings')
  .version('0.1.0')

registerPluginCommands(program)
registerDeviceCommands(program)
registerSettingsCommands(program)

program
  .command('repl')
  .description('Start an interactive REPL session')
  .action(async () => {
    await startRepl()
  })

program
  .command('mcp')
  .description('Start the MCP server (stdio transport)')
  .action(async () => {
    await startMcpServer()
  })

program.parseAsync(process.argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
