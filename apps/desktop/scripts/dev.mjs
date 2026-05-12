#!/usr/bin/env node
// Removes ELECTRON_RUN_AS_NODE from the child env before launching
// electron-vite. Some agentic shells (Claude Code) preset this variable, which
// causes Electron to boot as plain Node.js instead of as a desktop app.
// `delete` (vs. setting to empty string) eliminates the empty-vs-absent
// ambiguity that bit cross-env on Windows.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const pkgPath = require.resolve('electron-vite/package.json')
const bin = path.join(path.dirname(pkgPath), 'bin', 'electron-vite.js')

delete process.env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [bin, 'dev'], { stdio: 'inherit' })
child.on('exit', (code) => {
  process.exit(code ?? 0)
})
