import { protocol } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { PLUGINS_DIR } from '@nodalcore/plugin-host'

const SCHEME = 'nodal-plugin'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

function defaultCsp(pluginId: string): string {
  const origin = `${SCHEME}://${pluginId}`
  return [
    `default-src 'self' ${origin}`,
    `script-src 'self' ${origin}`,
    `style-src 'self' 'unsafe-inline' ${origin}`,
    `img-src 'self' ${origin} data:`,
    `font-src 'self' ${origin} data:`,
    `connect-src 'self' ${origin}`,
    `media-src 'self' ${origin}`,
    `frame-ancestors 'none'`,
    `form-action 'none'`,
    `base-uri 'self'`,
  ].join('; ')
}

/**
 * MUST be called before `app.whenReady()`. Tells Chromium that
 * `nodal-plugin://` is a privileged scheme — supports fetch + service workers
 * boundary correctly, treats each plugin's hostname as a distinct origin so
 * cross-plugin storage is naturally partitioned, and disables CORS so plugin
 * webviews can `fetch()` their own files freely.
 */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
      },
    },
  ])
}

/**
 * Register the actual `nodal-plugin://` request handler. Call after
 * `app.whenReady()`. Resolves URLs of the form
 *   nodal-plugin://<pluginId>/<relative-path>
 * to files under `~/.nodalcore/plugins/<pluginId>/`. Defends against `..`
 * traversal and symlink escape, and applies a locked-down CSP to HTML
 * responses.
 */
export function registerProtocolHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const pluginId = url.hostname
      // Guard the pluginId against shell-style globs / path injection.
      if (!/^[a-zA-Z0-9._-]+$/.test(pluginId)) {
        return new Response('Forbidden', { status: 403 })
      }
      const decoded = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
      const pluginRoot = path.join(PLUGINS_DIR, pluginId)
      const requested = path.resolve(pluginRoot, decoded)

      // `..` defense: requested path must live under pluginRoot.
      if (requested !== pluginRoot && !requested.startsWith(pluginRoot + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }

      // Symlink defense: realpath must also stay under pluginRoot.
      let real: string
      try {
        real = await fs.realpath(requested)
      } catch {
        return new Response('Not Found', { status: 404 })
      }
      if (real !== pluginRoot && !real.startsWith(pluginRoot + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }

      const data = await fs.readFile(real)
      const ext = path.extname(real).toLowerCase()
      const headers: Record<string, string> = {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
      }
      if (ext === '.html' || ext === '.htm') {
        headers['Content-Security-Policy'] = defaultCsp(pluginId)
      }
      return new Response(new Uint8Array(data), { headers })
    } catch (err) {
      console.error('[nodal-plugin protocol]', err)
      return new Response('Internal Error', { status: 500 })
    }
  })
}
