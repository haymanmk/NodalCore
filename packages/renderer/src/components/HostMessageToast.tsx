import { useEffect, useState, useCallback, useRef } from 'react'
import { getNodalCoreBridge, type HostWindowMessage } from '../hooks/usePluginBridge.js'

interface ToastEntry extends HostWindowMessage {
  id: number
}

const DISMISS_AFTER_MS = 4000

export function HostMessageToast() {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  // Per-toast dismiss timers so hover can pause and mouseleave can restart
  // them without affecting other toasts.
  const timers = useRef<Map<number, number>>(new Map())

  const clearTimer = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t !== undefined) {
      window.clearTimeout(t)
      timers.current.delete(id)
    }
  }, [])

  const dismiss = useCallback((id: number) => {
    clearTimer(id)
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [clearTimer])

  const scheduleDismiss = useCallback(
    (id: number) => {
      clearTimer(id)
      const handle = window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS)
      timers.current.set(id, handle)
    },
    [clearTimer, dismiss],
  )

  useEffect(() => {
    const bridge = getNodalCoreBridge()
    if (!bridge.onHostMessage) return

    let nextId = 1
    const unsubscribe = bridge.onHostMessage((msg) => {
      const id = nextId++
      setToasts((prev) => [...prev, { ...msg, id }])
      scheduleDismiss(id)
    })

    return unsubscribe
  }, [scheduleDismiss])

  useEffect(() => {
    const ts = timers.current
    return () => {
      ts.forEach((handle) => window.clearTimeout(handle))
      ts.clear()
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="host-toast">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`host-toast__item host-toast__item--${t.level ?? 'info'}`}
          onMouseEnter={() => clearTimer(t.id)}
          onMouseLeave={() => scheduleDismiss(t.id)}
        >
          <button
            type="button"
            className="host-toast__close"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M2 2 L8 8 M8 2 L2 8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span className="host-toast__plugin">{t.pluginId}</span>
          <span className="host-toast__message">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
