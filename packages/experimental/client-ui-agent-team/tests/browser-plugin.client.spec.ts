import { apply as applyHost } from '../src/index.ts'
import { Context } from '@arx-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@arx-ai/arx-session'
import type { TeamActionInjected } from '../src/client/TeamAction.tsx'
import { apply, inject } from '../src/client/index.ts'

describe('Agent Team browser registration', () => {
  it('registers an optional header action and navigates through public session APIs', async () => {
    const ctx = new Context()
    const open = vi.fn()
    const openSubagent = vi.fn()
    const refreshSubagents = vi.fn(() => Promise.resolve())
    const address = { parentSessionId: SessionId('lead'), childSessionId: SessionId('member'), mode: 'continuable' as const }
    ctx.provide('sessions', {
      open, openSubagent, refreshSubagents,
      subagentAddress: (id: SessionId) => id === address.childSessionId ? address : undefined,
    })
    ctx.provide('locale', { register: () => () => {} })
    let factory: (() => TeamActionInjected) | undefined
    ctx.provide('slots', {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: (options: { inject?: () => TeamActionInjected }) => {
        factory = options.inject
        return () => {}
      },
    })

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const injected = factory!()
    await injected.openMember(address.parentSessionId, address.childSessionId)
    expect(refreshSubagents).toHaveBeenCalledWith(address.parentSessionId)
    expect(openSubagent).toHaveBeenCalledWith(address)
    expect(open).not.toHaveBeenCalled()
    await injected.openMember(address.parentSessionId, address.parentSessionId)
    expect(open).toHaveBeenLastCalledWith(address.parentSessionId)
    await injected.openMember(address.parentSessionId, SessionId('detached'))
    expect(open).toHaveBeenLastCalledWith(SessionId('detached'))

    await fiber.dispose()
  })
})

it('keeps the browser-only Host half inert', () => { expect(() => { applyHost() }).not.toThrow() })
