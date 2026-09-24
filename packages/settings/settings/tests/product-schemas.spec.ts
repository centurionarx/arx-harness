import { describe, expect, it } from 'vitest'
import z from '@arx-ai/schemastery'
import { Config as PiConfig } from '@arx-ai/arx-llm-pi-ai'
import { AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA } from '@arx-ai/arx-agent-default-model'
import { AGENT_LOOP_SETTINGS_SCHEMA } from '@arx-ai/arx-agent-loop'
import { redactSchema, redactSecrets } from '../src/redact.ts'

/** Product schemas with nested primitive/object, false/dict and discriminated unions. */
describe('product settings redaction compatibility', () => {
  it('preserves pi-ai routing, retry, reasoning and chat-template configuration', () => {
    const value = PiConfig({ providers: { fixture: {
      apiKeyEnv: 'FIXTURE_CREDENTIAL_REF',
      models: [{ id: 'fixture-model', reasoningEfforts: { off: null, high: 'high' } }],
      modelOverrides: { disabled: { reasoningEfforts: false } },
      compat: { chatTemplateKwargs: {
        label: 'public', enabled: true, count: 2, unset: null,
        thinking: { $var: 'thinking.enabled', omitWhenOff: true },
      } },
      retryPolicy: { mode: 'normal', maxRetries: 2 },
    }, always: { retryPolicy: { mode: 'always' } } } })
    const result = redactSecrets(PiConfig as z<never>, value)
    expect(result.value).toEqual(value)
    expect(result.secrets).toEqual([])
    const schema = z(redactSchema(PiConfig as z<never>) as z<never>)
    expect(schema(value as never)).toEqual(value)
  })

  it.each([
    ['default model', AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA],
    ['agent loop', AGENT_LOOP_SETTINGS_SCHEMA],
  ])('preserves the %s settings schema', (_name, schema) => {
    const value = schema()
    expect(redactSecrets(schema as z<never>, value).value).toEqual(value)
    expect(z(redactSchema(schema as z<never>) as z<never>)()).toEqual(value)
  })
})
