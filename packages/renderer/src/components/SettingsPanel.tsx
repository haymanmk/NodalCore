import React, { useCallback } from 'react'
import Form from '@rjsf/core'
import type { ValidatorType } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'
import type { IChangeEvent } from '@rjsf/core'
import type { JSONSchema7 } from 'json-schema'
import type { SettingsRecord } from '@nodalcore/sdk'

export interface SettingsPanelProps {
  pluginId: string
  schema: JSONSchema7
  /** Current values pre-populated from readSettings() */
  formData?: SettingsRecord
  /** Called with the full settings object when the user submits */
  onSubmit: (pluginId: string, settings: SettingsRecord) => void | Promise<void>
  /** Called on every field change (useful for live preview) */
  onChange?: (pluginId: string, settings: SettingsRecord) => void
  readOnly?: boolean
}

export function SettingsPanel({
  pluginId,
  schema,
  formData,
  onSubmit,
  onChange,
  readOnly = false,
}: SettingsPanelProps) {
  const handleSubmit = useCallback(
    async (data: IChangeEvent<SettingsRecord>) => {
      if (data.formData) {
        await onSubmit(pluginId, data.formData)
      }
    },
    [pluginId, onSubmit],
  )

  const handleChange = useCallback(
    (data: IChangeEvent<SettingsRecord>) => {
      if (onChange && data.formData) {
        onChange(pluginId, data.formData)
      }
    },
    [pluginId, onChange],
  )

  return (
    <div className="settings-panel">
      <Form
        schema={schema as JSONSchema7}
        formData={formData}
        validator={validator as unknown as ValidatorType}
        onSubmit={handleSubmit}
        onChange={handleChange}
        disabled={readOnly}
        uiSchema={{
          'ui:submitButtonOptions': {
            submitText: 'Apply',
            norender: readOnly,
          },
        }}
      />
    </div>
  )
}
