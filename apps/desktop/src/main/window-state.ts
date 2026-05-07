import type { BrowserWindow } from 'electron'

let win: BrowserWindow | null = null
let quitting = false

export function bindWindow(w: BrowserWindow | null): void {
  win = w
}

export function getWindow(): BrowserWindow | null {
  return win
}

export function isWindowVisible(): boolean {
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()
}

export function showWindow(): void {
  if (!win || win.isDestroyed()) return
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

export function hideWindow(): void {
  if (!win || win.isDestroyed()) return
  win.hide()
}

/** Set true *before* calling app.quit() so the window's close handler stops intercepting. */
export function beginQuit(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
