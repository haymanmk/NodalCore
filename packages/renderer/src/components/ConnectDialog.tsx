import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Form from '@rjsf/core'
import type { IChangeEvent } from '@rjsf/core'
import type { ValidatorType } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'
import type { JSONSchema7 } from 'json-schema'
import type { ConnectionOptions, ConnectionType } from '@nodalcore/sdk'
import { connectionSchemas } from '@nodalcore/sdk/schemas/connection'

export interface ConnectDialogProps {
  pluginId: string
  pluginName: string
  connectionType: ConnectionType
  /** Last-used options, or null if first connect. */
  initialOptions: ConnectionOptions | null
  /** User clicked Connect — parent calls bridge.connect(pluginId, options). */
  onSubmit: (options: ConnectionOptions) => Promise<void>
  /** User clicked Cancel or pressed Esc. */
  onCancel: () => void
}

function deriveIcon(name: string) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
  const seed = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 37
  const hue = seed % 360
  return { initials, hue }
}

export function ConnectDialog({
  pluginId,
  pluginName,
  connectionType,
  initialOptions,
  onSubmit,
  onCancel,
}: ConnectDialogProps) {
  const schema = connectionSchemas[connectionType] as JSONSchema7

  const [formData, setFormData] = useState<Record<string, unknown>>(
    () => (initialOptions ? { ...(initialOptions as object) } : { connectionType }),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Esc closes the dialog; click-outside intentionally does NOT (RJSF text
  // inputs steal focus and we don't want a stray click outside the form
  // discarding the user's edits).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submitting, onCancel])

  // Initial focus: the first input inside the form.
  const formRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input, select')?.focus()
  }, [])

  const handleSubmit = useCallback(
    async (data: IChangeEvent<Record<string, unknown>>) => {
      if (!data.formData) return
      const opts = { ...data.formData, connectionType } as unknown as ConnectionOptions
      setSubmitting(true)
      setError(null)
      try {
        await onSubmit(opts)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setSubmitting(false)
      }
    },
    [connectionType, onSubmit],
  )

  const { initials, hue } = useMemo(() => deriveIcon(pluginName), [pluginName])

  return (
    <div className="connect-dialog__backdrop" role="presentation">
      <div
        className="connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`connect-dialog-title-${pluginId}`}
        ref={formRef}
      >
        <button
          type="button"
          className="connect-dialog__close"
          onClick={onCancel}
          disabled={submitting}
          aria-label="Close"
        >
          ×
        </button>

        <header className="connect-dialog__header">
          <div
            className="connect-dialog__icon"
            style={{
              background: `linear-gradient(135deg, hsl(${hue} 60% 40%), hsl(${(hue + 40) % 360} 60% 40%))`,
            }}
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="connect-dialog__head-text">
            <div className="connect-dialog__eyebrow">Connect device</div>
            <h2 id={`connect-dialog-title-${pluginId}`} className="connect-dialog__title">
              {pluginName}
            </h2>
            <span className="connect-dialog__pill">{connectionType}</span>
          </div>
        </header>

        <Form
          schema={schema}
          formData={formData}
          validator={validator as unknown as ValidatorType}
          onChange={(e) => setFormData(e.formData ?? {})}
          onSubmit={handleSubmit}
          disabled={submitting}
          uiSchema={{
            connectionType: { 'ui:widget': 'hidden' },
            password: { 'ui:widget': 'password' },
          }}
        >
          {error && (
            <div className="connect-dialog__error" role="alert">
              {error}
            </div>
          )}

          <div className="connect-dialog__footer">
            <button
              type="button"
              className="connect-dialog__btn connect-dialog__btn--cancel"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="connect-dialog__btn connect-dialog__btn--submit"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <span className="connect-dialog__spinner" aria-hidden="true" />
                  Connecting…
                </>
              ) : (
                'Connect'
              )}
            </button>
          </div>
        </Form>
      </div>
    </div>
  )
}
