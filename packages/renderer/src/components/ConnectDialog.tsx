import { useCallback, useEffect, useRef, useState } from 'react'
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

  return (
    <div className="connect-dialog__backdrop" role="presentation">
      <div
        className="connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`connect-dialog-title-${pluginId}`}
        ref={formRef}
      >
        <header className="connect-dialog__header">
          <h2 id={`connect-dialog-title-${pluginId}`} className="connect-dialog__title">
            Connect — {pluginName}
          </h2>
          <p className="connect-dialog__sub">{connectionType.toUpperCase()} connection</p>
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
              {submitting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </Form>
      </div>
    </div>
  )
}
