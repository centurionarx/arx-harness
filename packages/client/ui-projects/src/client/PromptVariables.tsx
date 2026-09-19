import { useState, type ReactElement } from 'react'
import type { PromptVariableDefinition } from '@arx-ai/arx-api-remotes/client'
interface Row {
  id: number
  name: string
  definition: PromptVariableDefinition
}
/** Structured variable schema editor; invalid or duplicate names block form submission. */
export function PromptVariables({
  initial,
  change,
  disabled,
}: {
  initial: Readonly<Record<string, PromptVariableDefinition>>
  change: (value: Readonly<Record<string, PromptVariableDefinition>>) => void
  disabled: boolean
}): ReactElement {
  const [rows, setRows] = useState<readonly Row[]>(() =>
    Object.entries(initial).map(([name, definition], id) => ({ id, name, definition })),
  )
  const publish = (next: readonly Row[]): void => {
    setRows(next)
    change(Object.fromEntries(next.map(row => [row.name, row.definition])))
  }
  return (
    <fieldset disabled={disabled}>
      <legend>Prompt variables</legend>
      {rows.map(row => (
        <div key={row.id}>
          <label>
            Variable name
            <input
              required
              pattern="[A-Za-z_][A-Za-z0-9_.\-]*"
              value={row.name}
              ref={(input) => {
                input?.setCustomValidity(
                  rows.some(other => other.id !== row.id && other.name === row.name)
                    ? 'Variable names must be unique'
                    : ['__proto__', 'prototype', 'constructor'].includes(row.name)
                      ? 'Choose another variable name'
                      : '',
                )
              }}
              onChange={(event) => {
                const name = event.currentTarget.value
                publish(rows.map(other => (other.id === row.id ? { ...row, name } : other)))
              }}
            />
          </label>
          <label>
            Variable type
            <select
              value={row.definition.type}
              onChange={(event) => {
                publish(
                  rows.map(other =>
                    other.id === row.id
                      ? {
                        ...row,
                        definition: {
                          ...row.definition,
                          type: event.currentTarget.value as PromptVariableDefinition['type'],
                        },
                      }
                      : other,
                  ),
                )
              }}
            >
              <option>string</option>
              <option>number</option>
              <option>boolean</option>
              <option>json</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={row.definition.required}
              onChange={(event) => {
                publish(
                  rows.map(other =>
                    other.id === row.id
                      ? { ...row, definition: { ...row.definition, required: event.currentTarget.checked } }
                      : other,
                  ),
                )
              }}
            />
            Required
          </label>
          <button
            type="button"
            onClick={() => {
              publish(rows.filter(other => other.id !== row.id))
            }}
          >
            Remove variable
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          publish([
            ...rows,
            {
              id: Math.max(-1, ...rows.map(row => row.id)) + 1,
              name: '',
              definition: { type: 'string', required: true },
            },
          ])
        }}
      >
        Add variable
      </button>
    </fieldset>
  )
}
