# Example: device-bridge plugin

A minimal reference implementation of a **device-bridge** plugin for
NodalCore. Simulates a serial multimeter without requiring real hardware.

## What it demonstrates

- Correct `nodal.json` structure for a serial device
- Extending `DevicePlugin` from `@nodalcore/sdk`
- Implementing `connect`, `disconnect`, `readSettings`, and `writeSettings`
- In-memory settings storage pattern

## Files

```
nodal.json      Plugin manifest (id, schema, permissions)
src/index.ts    MultimeterPlugin class
```

## Settings schema

| Field | Type | Default |
|---|---|---|
| `unit` | `enum` (V / mV / A / mA / Ω / kΩ) | `"V"` |
| `autoRange` | `boolean` | `true` |
| `sampleRate` | `number` (1–1000 Hz) | `10` |

## Installing locally for testing

```bash
# From the repo root
node apps/cli/dist/index.js plugin install ./examples/plugin-device-bridge
node apps/cli/dist/index.js device connect example-multimeter --port /dev/ttyUSB0
```
