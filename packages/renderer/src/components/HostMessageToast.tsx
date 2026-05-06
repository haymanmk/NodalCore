import { useEffect, useState, useCallback } from 'react'
import { getNodalCoreBridge, type HostWindowMessage } from '../hooks/usePluginBridge.js'

interface ToastEntry extends HostWindowMessage {
  id: number
}

const DISMISS_AFTER_MS = 4000

export function HostMessageToast() {
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  useEffect(() => {
    const bridge = getNodalCoreBridge()
    if (!bridge.onHostMessage) return

    let nextId = 1
    const unsubscribe = bridge.onHostMessage((msg) => {
      const id = nextId++
      setToasts((prev) => [...prev, { ...msg, id }])
      window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS)
    })

    return unsubscribe
  }, [dismiss])

  if (toasts.length === 0) return null

  return (
    <div className="host-toast">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`host-toast__item host-toast__item--${t.level ?? 'info'}`}
          onClick={() => dismiss(t.id)}
        >
          <span className="host-toast__plugin">{t.pluginId}</span>
          <span className="host-toast__message">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
