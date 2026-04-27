# @nodalcore/registry-client

HTTP client for the NodalCore central plugin registry. Used by the desktop
Store page and the CLI `plugin search` command.

## API

```ts
import {
  fetchIndex,
  searchPlugins,
  getPlugin,
} from '@nodalcore/registry-client'
import type { RegistryIndex, RegistryPluginEntry } from '@nodalcore/registry-client'
```

### `fetchIndex(options?)`

Fetches the full registry index. Results are cached for 5 minutes.

```ts
const index = await fetchIndex()
// index.plugins — RegistryPluginEntry[]

// Force refresh
const fresh = await fetchIndex({ force: true })

// Custom registry URL
const index = await fetchIndex({ registryUrl: 'https://my-registry.example.com/index.json' })
```

### `searchPlugins(options)`

Filters the registry by name, description, or tags.

```ts
const results = await searchPlugins({ query: 'serial' })
const results = await searchPlugins({ query: 'sensor', type: 'device-bridge' })
const results = await searchPlugins({ query: '', tags: ['bluetooth'] })
```

### `getPlugin(id, options?)`

Returns a single plugin entry by ID, or `undefined` if not found.

```ts
const plugin = await getPlugin('com.nodalcore.usb-oscilloscope')
```

## Configuration

Set `NODALCORE_REGISTRY_URL` in the environment to override the default
registry URL (`https://nodalcore.github.io/registry/index.json`).

## Development fallback

`StorePage` in `@nodalcore/renderer` falls back to the mock data in
`packages/renderer/src/mockRegistry.ts` when `fetchIndex()` throws (e.g. when
the registry URL is unreachable in local development).
