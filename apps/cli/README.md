# @nodalcore/cli

Command-line interface for NodalCore. Provides plugin management, an
interactive REPL, and an MCP server for AI-agent integration — all
without the Electron desktop app.

## Usage

```bash
# Build first
pnpm --filter @nodalcore/cli build

# Then run
node apps/cli/dist/index.js <command>
```

## Commands

### Plugin management

```bash
plugin list                                  # list installed plugins
plugin search <query> [--type <type>]        # search the registry
plugin install <id-or-git-url-or-local-dir>  # install a plugin
plugin uninstall <id>                        # remove a plugin
```

### Device control

```bash
device connect <plugin-id> [options]
  --port <port>          Serial / TCP port or address
  --baud <rate>          Serial baud rate (default 9600)
  --host <host>          TCP / MQTT host
  --tcp-port <port>      TCP port number
  --topic <topic>        MQTT topic

device disconnect <plugin-id>
```

### Settings

Settings live in the host configuration store at
`~/.nodalcore/configurations.json`, keyed by plugin id. The schema for
each plugin's values comes from its `manifest.contributes.configuration`.

```bash
settings get <plugin-id>                # print current settings as JSON
settings set <plugin-id> <key> <value>  # write a single setting (merge)
settings schema <plugin-id>             # print the JSON Schema
```

### Interactive REPL

```bash
node apps/cli/dist/index.js repl
```

Starts a readline session. Available commands:

```
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
```

### MCP server

```bash
node apps/cli/dist/index.js mcp
```

Starts a JSON-RPC 2.0 server over stdio using the Model Context Protocol
SDK. Exposes the following tools:

| Tool | Purpose |
|---|---|
| `list_plugins` | List installed plugins |
| `search_plugins` | Search the registry by query / type |
| `install_plugin` | Install a plugin from id, git URL, or local path |
| `uninstall_plugin` | Remove an installed plugin |
| `connect_device` | Load a device-bridge plugin and call `connect(options)` |
| `disconnect_device` | Disconnect an active device session |
| `read_settings` | Read a plugin's persisted configuration from the host store |
| `write_settings` | Merge values into the host configuration store |
| `get_settings_schema` | Return the JSON Schema for `manifest.contributes.configuration` |

Plus a resource at `nodalcore://plugins` returning the installed-plugins
list.

## Output format

The CLI auto-detects the output context:

| Context | Format |
|---|---|
| Interactive TTY | Human-readable aligned tables |
| Pipe / redirect | JSONL — one JSON object per line |
| MCP server | JSON content blocks (per the MCP spec) |
