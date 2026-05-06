import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
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

const sessions = new Map<string, Awaited<ReturnType<typeof loadDevicePlugin>>>()

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'nodalcore',
    version: '0.1.0',
  })

  // ── Tools ────────────────────────────────────────────────

  server.tool('list_plugins', 'List all installed plugins', {}, async () => {
    const plugins = await listInstalledPlugins()
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            plugins.map((p) => ({
              id: p.manifest.id,
              name: p.manifest.name,
              version: p.manifest.version,
              type: p.manifest.type,
              status: p.status,
            })),
            null,
            2,
          ),
        },
      ],
    }
  })

  server.tool(
    'search_plugins',
    'Search the plugin registry',
    { query: z.string(), type: z.enum(['device-bridge', 'standalone-tool']).optional() },
    async ({ query, type }) => {
      const results = await searchPlugins({ query, type })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      }
    },
  )

  server.tool(
    'install_plugin',
    'Install a plugin by id or git URL',
    { source: z.string() },
    async ({ source }) => {
      const manifest = await installPlugin({ source })
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { id: manifest.id, name: manifest.name, version: manifest.version, installed: true },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  server.tool(
    'uninstall_plugin',
    'Uninstall a plugin by id',
    { id: z.string() },
    async ({ id }) => {
      await uninstallPlugin(id)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ id, uninstalled: true }) }],
      }
    },
  )

  server.tool(
    'connect_device',
    'Connect to a device via its plugin',
    {
      pluginId: z.string(),
      connectionOpts: z.record(z.unknown()).optional(),
    },
    async ({ pluginId, connectionOpts }) => {
      const proxy = await loadDevicePlugin(pluginId)
      await proxy.connect((connectionOpts ?? {}) as unknown as ConnectionOptions)
      sessions.set(pluginId, proxy)
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ pluginId, connected: true }) },
        ],
      }
    },
  )

  server.tool(
    'disconnect_device',
    'Disconnect from a device plugin',
    { pluginId: z.string() },
    async ({ pluginId }) => {
      const session = sessions.get(pluginId)
      if (!session) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'No active session' }) },
          ],
          isError: true,
        }
      }
      await session.disconnect()
      sessions.delete(pluginId)
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ pluginId, disconnected: true }) },
        ],
      }
    },
  )

  server.tool(
    'read_settings',
    'Read a plugin\'s persisted configuration from the host configuration store',
    { pluginId: z.string() },
    async ({ pluginId }) => {
      const values = await getConfiguration(pluginId)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(values, null, 2) }],
      }
    },
  )

  server.tool(
    'write_settings',
    'Merge values into a plugin\'s persisted configuration in the host configuration store',
    { pluginId: z.string(), settings: z.record(z.unknown()) },
    async ({ pluginId, settings }) => {
      await setConfiguration(pluginId, settings)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ pluginId, updated: true, settings }),
          },
        ],
      }
    },
  )

  server.tool(
    'get_settings_schema',
    'Get the JSON Schema for a plugin\'s contributes.configuration block',
    { pluginId: z.string() },
    async ({ pluginId }) => {
      const entry = await getInstalledPlugin(pluginId)
      const cfg = entry?.manifest.contributes?.configuration
      if (!cfg) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Plugin declares no contributes.configuration' }),
            },
          ],
          isError: true,
        }
      }
      const schema = { type: 'object', title: cfg.title, properties: cfg.properties }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(schema, null, 2) }],
      }
    },
  )

  // ── Resources ────────────────────────────────────────────

  server.resource(
    'installed-plugins',
    'nodalcore://plugins',
    async () => {
      const plugins = await listInstalledPlugins()
      return {
        contents: [
          {
            uri: 'nodalcore://plugins',
            text: JSON.stringify(
              plugins.map((p) => ({
                id: p.manifest.id,
                name: p.manifest.name,
                version: p.manifest.version,
                type: p.manifest.type,
              })),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Start ────────────────────────────────────────────────

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
