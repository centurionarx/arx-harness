/**
 * Session edge behavior: scope binding, disposal across in-flight calls,
 * subagent prompt routing, attachment/queue/command failures, stale older-page
 * pulls after a resync, and subagent address/availability updates.
 */
import { Context } from '@arx-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubagentAddress, SessionId } from '@arx-ai/arx-api-remotes/client'
import { Session } from '../src/client/sessions/session.ts'
import { FakeApiClient, deferred, err, fakeRemote, ok } from './fake-api.client.ts'
import { entries, plainTurn } from './event-script.client.ts'

const SID = 'fk-edge' as SessionId
const PARENT = 'fk-edge-parent' as SessionId
const CONTINUABLE: SubagentAddress = { parentSessionId: PARENT, childSessionId: SID, mode: 'continuable' }
const text = [{ type: 'text' as const, text: 'go' }]
const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'AA==' }

afterEach(() => {
  vi.restoreAllMocks()
})

function page(seq: number, hasMore: boolean) {
  return ok({ events: entries(plainTurn(seq, 0, 'u', 'a')) as never[], hasMore })
}

describe('scope binding', () => {
  it('rejects a second scope binding until the first is released', () => {
    const session = new Session(SID, new FakeApiClient(), fakeRemote())
    const scope = new Context()
    session.bindScope(scope)
    expect(() => { session.bindScope(new Context()) }).toThrow(`session ${SID} already has a bound scope`)
    session.unbindScope()
    expect(() => { session.bindScope(scope) }).not.toThrow()
  })
})

describe('disposal', () => {
  it('fails every action started after dispose without touching the wire', async () => {
    const api = new FakeApiClient()
    const session = new Session(SID, api, fakeRemote())
    session.dispose()
    session.rebuildConversationRegistry()

    for (const outcome of [
      await session.prompt(text, 'queue'),
      await session.cancel(),
      await session.rename('x'),
      await session.readAttachment('a' as never),
      await session.updateQueue('m' as never, { type: 'cancel' } as never),
    ]) {
      expect(outcome).toMatchObject({ ok: false, error: { message: 'session is disposed' } })
    }
    await expect(session.command('/x')).rejects.toThrow('session is disposed')
    expect(api.calls).toEqual([])
  })

  it('discards a prompt and a cancel that settle after dispose', async () => {
    const api = new FakeApiClient()
    const session = new Session(SID, api, fakeRemote())
    const prompt = deferred<Awaited<ReturnType<FakeApiClient['onPrompt']>>>()
    const cancel = deferred<Awaited<ReturnType<FakeApiClient['onCancel']>>>()
    api.onPrompt = () => prompt.promise
    api.onCancel = () => cancel.promise
    const sending = session.prompt(text, 'queue')
    const stopping = session.cancel()
    session.dispose()
    prompt.resolve(ok({ accepted: true as const }))
    cancel.resolve(ok({ accepted: true as const }))
    await expect(sending).resolves.toMatchObject({ ok: false, error: { message: 'session is disposed' } })
    await expect(stopping).resolves.toMatchObject({ ok: false, error: { message: 'session is disposed' } })
  })

  it('discards a command that settles after dispose', async () => {
    const remote = fakeRemote()
    const gate = deferred<{ ok: true; value: undefined }>()
    remote.commands.execute = () => gate.promise
    const session = new Session(SID, new FakeApiClient(), remote)
    const running = session.command('/slow')
    const rejected = expect(running).rejects.toThrow('session is disposed')
    session.dispose()
    gate.resolve({ ok: true, value: undefined })
    await rejected
  })

  it('settles pending waits on dispose so a late respond is refused', () => {
    const session = new Session(SID, new FakeApiClient(), fakeRemote())
    session.handleMuxEnvelope('ra' as never, {
      type: 'approval/requested', sessionId: SID, approvalId: 'ap' as never, toolName: 'rm',
    })
    const wait = session.getSnapshot().pending[0]!
    session.dispose()
    expect(() => wait.respond({ ok: false, error: { code: 'internal', message: 'x', details: {} } }))
      .toThrow('already settled')
  })
})

describe('approval waits', () => {
  it('answers an approval through the client-response carrier with the requested rpcId', async () => {
    const api = new FakeApiClient()
    const session = new Session(SID, api, fakeRemote())
    session.handleMuxEnvelope('ra' as never, {
      type: 'approval/requested', sessionId: SID, approvalId: 'ap' as never, toolName: 'rm',
    })
    const result = { ok: false as const, error: { code: 'internal' as const, message: 'no', details: {} } }
    await session.getSnapshot().pending[0]!.respond(result)
    expect(api.callsOf('respond')).toEqual([{ type: 'client-response', rpcId: 'ra', result }])
  })
})

describe('command', () => {
  it('reports whether the line matched a command and passes admission failures through', async () => {
    const remote = fakeRemote()
    const session = new Session(SID, new FakeApiClient(), remote)
    remote.commands.execute = () => Promise.resolve({ ok: true, value: undefined })
    await expect(session.command('/none')).resolves.toEqual({ ok: true, value: { matched: false } })
    remote.commands.execute = () => Promise.resolve({ ok: true, value: { id: 'c1' } } as never)
    await expect(session.command('/some')).resolves.toEqual({ ok: true, value: { matched: true } })
    const failure = { ok: false, error: { code: 'internal', message: 'denied', details: {} } }
    remote.commands.execute = () => Promise.resolve(failure as never)
    await expect(session.command('/bad')).resolves.toBe(failure)
  })
})

describe('subagent prompts', () => {
  it('refuses image input for a continuation without calling the wire', async () => {
    const api = new FakeApiClient()
    const session = new Session(SID, api, fakeRemote(), { address: CONTINUABLE })
    await expect(session.prompt([...text, image], 'queue')).resolves.toMatchObject({
      ok: false, error: { code: 'attachment-error', details: { reason: 'SUBAGENT_IMAGE_UNSUPPORTED' } },
    })
    expect(api.callsOf('subagent.prompt')).toEqual([])
    expect(session.getSnapshot().promptError).toMatchObject({ op: 'send' })
  })

  it('surfaces a rejected continuation prompt as the prompt error', async () => {
    const api = new FakeApiClient()
    api.onSubagentPrompt = () => Promise.resolve(err({ code: 'subagent-delivery-unavailable', message: 'parent gone', details: {} } as never))
    const session = new Session(SID, api, fakeRemote(), { address: CONTINUABLE })
    await expect(session.prompt(text, 'queue')).resolves.toMatchObject({ ok: false, error: { message: 'parent gone' } })
    expect(session.getSnapshot().promptError).toMatchObject({ op: 'send', error: { message: 'parent gone' } })
  })
})

describe('attachments and queue', () => {
  it('returns a Host attachment rejection unchanged and folds transport throws', async () => {
    const api = new FakeApiClient()
    const session = new Session(SID, api, fakeRemote())
    api.onAttachment = () => Promise.resolve(err({ code: 'internal', message: 'gone', details: {} }))
    await expect(session.readAttachment('a' as never)).resolves.toMatchObject({ ok: false, error: { message: 'gone' } })
    api.onAttachment = () => Promise.reject(new Error('attachment wire'))
    await expect(session.readAttachment('a' as never)).resolves.toMatchObject({ ok: false, error: { message: 'attachment wire' } })
  })

  it('folds a queue update transport throw into a failed result', async () => {
    const api = new FakeApiClient()
    api.onUpdateQueue = () => Promise.reject(new Error('queue wire'))
    const session = new Session(SID, api, fakeRemote())
    await expect(session.updateQueue('m' as never, { type: 'cancel' } as never))
      .resolves.toMatchObject({ ok: false, error: { message: 'queue wire' } })
  })
})

describe('older pages across a resync', () => {
  async function opened() {
    const api = new FakeApiClient()
    const session = new Session(SID, api, fakeRemote())
    api.onHistory = () => Promise.resolve(page(10, true))
    await session.open()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onHistory']>>>()
    let calls = 0
    api.onHistory = () => (calls++ === 0 ? gate.promise : Promise.resolve(page(10, true)))
    return { session, gate }
  }

  it('drops an older page that lands after a resync rebuilt the window', async () => {
    const { session, gate } = await opened()
    const older = session.loadOlder()
    await session.resync()
    gate.resolve(page(0, false))
    await older
    expect(session.getSnapshot()).toMatchObject({ hasMore: true })
  })

  it('stays silent about an older-page failure that belongs to a replaced window', async () => {
    const { session, gate } = await opened()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const older = session.loadOlder()
    await session.resync()
    gate.reject(new Error('stale page wire'))
    await older
    expect(error).not.toHaveBeenCalled()
  })
})

describe('subagent address and flags', () => {
  it('adopts an address on a cold session and rebuilds an opened window through the new route', async () => {
    const api = new FakeApiClient()
    const session = new Session(SID, api, fakeRemote())
    session.configureSubagent(CONTINUABLE, true)
    expect(session.getSnapshot().subagent).toEqual({ address: CONTINUABLE, parentAvailable: true })
    expect(api.calls).toEqual([])

    session.configureSubagent(undefined)
    await session.open()
    session.configureSubagent(CONTINUABLE, true)
    expect(api.callsOf('subagent.history')).toHaveLength(1)
    await session.resync()
  })

  it('keeps its snapshot when parent availability repeats the known value', () => {
    const session = new Session(SID, new FakeApiClient(), fakeRemote())
    const before = session.getSnapshot()
    session.handleSubagentParentAvailable(false)
    expect(session.getSnapshot()).toBe(before)
    session.handleSubagentParentAvailable(true)
    expect(session.getSnapshot().subagent).toBeNull()
  })

  it('never re-blanks a running session from a stale blank summary', () => {
    const session = new Session(SID, new FakeApiClient(), fakeRemote())
    session.handleRunning(true)
    session.handleBlank(true)
    expect(session.getSnapshot().blank).toBe(false)
  })
})
