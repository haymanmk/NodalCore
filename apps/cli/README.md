# @nodalcore/cli

Command-line interface for NodalCore. Provides a full plugin management
workflow, an interactive REPL, and an MCP server for AI agent integration —
all without the Electron desktop app.

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
plugin list                          # list installed plugins (table)
plugin search <query> [--type tool]  # search registry
plugin install <id-or-git-url>       # install a plugin
plugin uninstall <id>                # remove a plugin
```

### Device control

```bash
device connect <plugin-id> [options]
  --port <path>       serial port (e.g. /dev/ttyUSB0)
  --baud <rate>       baud rate (default 115200)
  --host <host>       TCP host
  --tcp-port <port>   TCP port
  --topic <topic>     MQTT topic

device disconnect <plugin-id>
```

### Settings

```bash
settings get <plugin-id>             # print current settings as JSON
settings set <plugin-id> <key=value> # update a setting
settings schema <plugin-id>          # print the JSON Schema
```

### Interactive REPL

```bash
node apps/cli/dist/index.js repl
```

Starts a readline session with commands: `plugins`, `connect`, `disconnect`,
`settings get/set/schema`, `status`, `help`, `exit`.

### MCP server

```bash
node apps/cli/dist/index.js mcp
```

Starts a JSON-RPC 2.0 server over stdio using the Model Context Protocol SDK.
Exposes tools: `list_plugins`, `search_plugins`, `install_plugin`,
`uninstall_plugin`, `connect_device`, `read_settings`, `write_settings`,
`subscribe_events`.

## Output format

The CLI auto-detects the output context:

| Context | Format |
|---|---|
| Interactive TTY | Human-readable aligned tables |
| Pipe / redirect | JSONL — one JSON object per line |
| MCP server | JSONL (always) |
