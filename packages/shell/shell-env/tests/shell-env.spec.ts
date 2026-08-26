/**
 * Registry tests for `@centurionarx/cxh-shell-env`: built-in facts, contributor
 * ownership and validation, collection ordering, effect-scoped disposal, and
 * the explicit disposer contract.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@centurionarx/cordis'
import { CallId } from '@centurionarx/cxh-llm'
import type { Agent } from '@centurionarx/cxh-agent'
import type { ToolExecution } from '@centurionarx/cxh-tools'
import { ShellEnvRegistry } from '@centurionarx/cxh-shell-env'
import * as BashEnvPlugin from '@centurionarx/cxh-shell-env'

const testToolSignal = new AbortController().signal

afterEach(() => vi.unstubAllEnvs())

function execution(sessionId?: string): ToolExecution {
  return {
    signal: testToolSignal,
    token: Symbol('bash-env-test') as ToolExecution['token'],
    callId: CallId('bash-env-call'),
    rootCallId: CallId('bash-env-call'),
    name: 'bash',
    arguments: { command: 'true' },
    ...(sessionId === undefined
      ? {}
      : { agent: { session: { header: { version: 0, id: sessionId, createdAt: 0 } } } as Agent }),
  }
}

describe('ShellEnvRegistry', () => {
  it('collects unconditional shell facts and the current agent session id', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { cxhHome: './test-cxh-home' })

    expect(registry.collect(execution())).toEqual({
      CXH_HOME: resolve('./test-cxh-home'),
      CXH_SHELL: '1',
    })
    expect(registry.collect(execution('session-a'))).toEqual({
      CXH_HOME: resolve('./test-cxh-home'),
      CXH_SESSION_ID: 'session-a',
      CXH_SHELL: '1',
    })
  })

  it('resolves CXH_HOME from the ambient override or the user-home default', () => {
    vi.stubEnv('CXH_HOME', './ambient-cxh-home')
    const fromEnvironment = new ShellEnvRegistry(new Context())
    expect(fromEnvironment.collect(execution()).CXH_HOME).toBe(resolve('./ambient-cxh-home'))

    vi.stubEnv('CXH_HOME', undefined)
    const fromDefault = new ShellEnvRegistry(new Context())
    expect(fromDefault.collect(execution()).CXH_HOME).toBe(join(homedir(), '.cxh'))
  })

  it('collects declared contributor variables and omits unavailable values', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { cxhHome: './test-cxh-home' })
    registry.register({
      name: 'optional-session-fact',
      variables: {
        CXH_SESSION_OPTIONAL: { description: 'Optional session-scoped test fact.' },
      },
      resolve: exec => exec.agent === undefined ? {} : { CXH_SESSION_OPTIONAL: exec.agent.session.header.id },
    })
    registry.register({
      name: 'always-available-fact',
      variables: {
        CXH_ALWAYS_AVAILABLE: { description: 'Always-available test fact.' },
      },
      resolve: () => ({ CXH_ALWAYS_AVAILABLE: 'yes' }),
    })

    expect(registry.collect(execution())).not.toHaveProperty('CXH_SESSION_OPTIONAL')
    expect(registry.collect(execution()).CXH_ALWAYS_AVAILABLE).toBe('yes')
    expect(registry.collect(execution('session-b')).CXH_SESSION_OPTIONAL).toBe('session-b')
    expect(registry.list()).toEqual([
      {
        contributor: 'always-available-fact',
        description: 'Always-available test fact.',
        key: 'CXH_ALWAYS_AVAILABLE',
      },
      {
        contributor: 'optional-session-fact',
        description: 'Optional session-scoped test fact.',
        key: 'CXH_SESSION_OPTIONAL',
      },
    ])
  })

  it('rejects duplicate variable ownership at registration time', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { cxhHome: './test-cxh-home' })
    registry.register({
      name: 'first',
      variables: { CXH_SHARED: { description: 'First owner.' } },
      resolve: () => ({ CXH_SHARED: 'first' }),
    })

    expect(() => registry.register({
      name: 'second',
      variables: { CXH_SHARED: { description: 'Second owner.' } },
      resolve: () => ({ CXH_SHARED: 'second' }),
    })).toThrow(/CXH_SHARED.*first.*second|CXH_SHARED.*second.*first/)
  })

  it('rejects duplicate contributor names and malformed declarations', () => {
    const registry = new ShellEnvRegistry(new Context(), { cxhHome: './test-cxh-home' })
    registry.register({
      name: 'declared',
      variables: { CXH_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({}),
    })

    expect(() => registry.register({
      name: 'declared',
      variables: { CXH_ANOTHER: { description: 'Another fact.' } },
      resolve: () => ({}),
    })).toThrow(/already registered/)
    expect(() => registry.register({
      name: ' ',
      variables: { CXH_BLANK_NAME: { description: 'Blank owner.' } },
      resolve: () => ({}),
    })).toThrow(/name must be non-empty/)
    expect(() => registry.register({
      name: 'invalid-key',
      variables: { cxh_invalid: { description: 'Invalid key.' } } as unknown as Record<'CXH_INVALID', { description: string }>,
      resolve: () => ({}),
    })).toThrow(/invalid key/)
    expect(() => registry.register({
      name: 'reserved-key',
      variables: { CXH_HOME: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key/)
    expect(() => registry.register({
      name: 'blank-description',
      variables: { CXH_BLANK_DESCRIPTION: { description: ' ' } },
      resolve: () => ({}),
    })).toThrow(/must describe/)
  })

  it('rejects undeclared variables returned by a contributor', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { cxhHome: './test-cxh-home' })
    registry.register({
      name: 'drifted-provider',
      variables: { CXH_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({ CXH_UNDECLARED: 'bad' }),
    })

    expect(() => registry.collect(execution())).toThrow(/drifted-provider.*CXH_UNDECLARED/)
  })

  it('rejects non-string values returned by a contributor', () => {
    const registry = new ShellEnvRegistry(new Context(), { cxhHome: './test-cxh-home' })
    registry.register({
      name: 'wrong-value-type',
      variables: { CXH_STRING: { description: 'String fact.' } },
      resolve: () => ({ CXH_STRING: 42 }) as unknown as Record<'CXH_STRING', string>,
    })

    expect(() => registry.collect(execution())).toThrow(/wrong-value-type.*non-string.*CXH_STRING/)
  })

  it('removes an effect-scoped contributor when its plugin is disposed', async () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { cxhHome: './test-cxh-home' })
    const fiber = await ctx.plugin({
      inject: ['shellEnv'],
      apply(inner: Context) {
        inner.shellEnv.register({
          name: 'temporary',
          variables: { CXH_TEMPORARY: { description: 'Temporary fact.' } },
          resolve: () => ({ CXH_TEMPORARY: 'present' }),
        })
      },
    })

    expect(registry.collect(execution()).CXH_TEMPORARY).toBe('present')
    await fiber.dispose()
    expect(registry.collect(execution())).not.toHaveProperty('CXH_TEMPORARY')
  })

  it('returns an explicit contributor disposer', () => {
    const registry = new ShellEnvRegistry(new Context(), { cxhHome: './test-cxh-home' })
    const dispose = registry.register({
      name: 'explicit-disposal',
      variables: { CXH_EXPLICIT_DISPOSAL: { description: 'Explicitly disposed fact.' } },
      resolve: () => ({ CXH_EXPLICIT_DISPOSAL: 'present' }),
    })

    expect(registry.collect(execution()).CXH_EXPLICIT_DISPOSAL).toBe('present')
    dispose()
    expect(registry.collect(execution())).not.toHaveProperty('CXH_EXPLICIT_DISPOSAL')
  })

  it('the plugin registers the service and the persistence contributor on load', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv).toBeInstanceOf(ShellEnvRegistry)
    expect(ctx.shellEnv.list()).toEqual([
      {
        contributor: 'session-persistence',
        description: 'Absolute target path of the current session JSONL when the active persistence backend provides one.',
        key: 'CXH_SESSION_JSONL',
      },
    ])
  })

  it('the persistence contributor resolves CXH_SESSION_JSONL only for a jsonl backend', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    ctx.provide('sessionPersistence', {
      locate: () => ({ kind: 'jsonl' as const, path: 'C:\\sessions\\s.jsonl' }),
    })
    expect(ctx.shellEnv.collect(execution('sess-p')).CXH_SESSION_JSONL).toBe('C:\\sessions\\s.jsonl')
  })

  it('the persistence contributor omits the variable for a non-jsonl backend', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    ctx.provide('sessionPersistence', {
      locate: () => ({ kind: 'sqlite' as const, path: 'C:\\sessions\\s.db' }),
    })
    expect(ctx.shellEnv.collect(execution('sess-p'))).not.toHaveProperty('CXH_SESSION_JSONL')
  })

  it('the persistence contributor omits the variable without a persistence backend', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv.collect(execution('sess-p'))).not.toHaveProperty('CXH_SESSION_JSONL')
  })
})
