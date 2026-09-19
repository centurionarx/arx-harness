// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@arx-ai/arx-client-test-runtime'
import type { ComponentProps } from 'react'
import { TurnOutline } from '../src/client/TurnOutline.tsx'
import { SessionId } from '@arx-ai/arx-session/types'
import type { TurnOutlinePage } from '@arx-ai/arx-session-turn-outline/client'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const turns = [
  { turn: 1, startSeq: 0, preview: 'First request', status: 'completed' },
  { turn: 31, startSeq: 300, preview: 'A recent request', status: 'running' },
]
function props(overrides: Partial<ComponentProps<typeof TurnOutline>> = {}): ComponentProps<typeof TurnOutline> {
  return { sessionId: 'outline-session', useProjection: () => ({ turns, total: 31, hasMore: false }),
    readPage: vi.fn(async (_before: number | null, query: string) => ({
      turns: turns.filter(turn => turn.preview.toLowerCase().includes(query.toLowerCase())), total: 31, hasMore: false,
    })),
    revealTurn: vi.fn(async () => true), cancelRevealTurn: vi.fn(), t: makeTranslate(en), ...overrides,
  } as unknown as ComponentProps<typeof TurnOutline>
}

it('shows the full projection and searches independently of the loaded conversation window', async () => {
  const input = props()
  render(<TurnOutline {...input} />)
  expect(screen.getByText('First request')).toBeTruthy()
  expect(screen.getByText('Turn 31')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Search turns'), { target: { value: 'first' } })
  await waitFor(() => { expect(screen.queryByText('Turn 31')).toBeNull(); expect(screen.getByText('First request')).toBeTruthy() })
  fireEvent.click(screen.getByText('First request'))
  await waitFor(() => { expect(input.revealTurn).toHaveBeenCalledWith(0) })
})

it.each([false, 'throw'])('shows a truthful refusal when history cannot be revealed: %s', async (failure) => {
  const revealTurn = vi.fn(async () => { if (failure === 'throw') throw new Error('offline'); return false })
  render(<TurnOutline {...props({ revealTurn })} />)
  fireEvent.click(screen.getByText('First request'))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('could not be opened') })
})

it('cancels pending owner navigation when the view unmounts', async () => {
  let resolve!: (value: boolean) => void
  const input = props({ revealTurn: () => new Promise<boolean>((done) => { resolve = done }) })
  const view = render(<TurnOutline {...input} />)
  fireEvent.click(screen.getByText('First request'))
  expect(screen.getByRole('status').textContent).toBe('Loading history…')
  view.unmount()
  expect(input.cancelRevealTurn).toHaveBeenCalledOnce()
  resolve(false)
})

it('renders unavailable and empty projection states without navigation', () => {
  const view = render(<TurnOutline {...props({ useProjection: (() => undefined) })} />)
  expect(screen.getByRole('status').textContent).toContain('unavailable')
  view.rerender(<TurnOutline {...props({ useProjection: (() => ({ turns: [], total: 0, hasMore: false })) })} />)
  expect(screen.getByText('No turns yet.')).toBeTruthy()
})

it('replaces bounded older pages instead of appending an unbounded DOM list', async () => {
  const current = { turns: Array.from({ length: 100 }, (_, index) => ({ turn: index + 101, startSeq: index + 200, preview: 'recent ' + String(index), status: 'completed' })), total: 200, hasMore: true, nextBefore: 200 }
  const older = { turns: Array.from({ length: 100 }, (_, index) => ({ turn: index + 1, startSeq: index, preview: 'old ' + String(index), status: 'completed' })), total: 200, hasMore: false }
  const input = props({ useProjection: (() => current), readPage: vi.fn(async () => older) })
  const view = render(<TurnOutline {...input} />)
  expect(view.container.querySelectorAll('li')).toHaveLength(100)
  fireEvent.click(screen.getByText('Older turns'))
  await screen.findByText('old 0')
  expect(input.readPage).toHaveBeenCalledWith(200, '')
  expect(view.container.querySelectorAll('li')).toHaveLength(100)
  expect(screen.queryByText('recent 0')).toBeNull()
  fireEvent.click(screen.getByText('Newest turns'))
  expect(screen.getByText('recent 0')).toBeTruthy()
  expect(view.container.querySelectorAll('li')).toHaveLength(100)
})

it('ignores stale page completions and reports only the active page failure', async () => {
  const pending: {
    resolve: (page: TurnOutlinePage) => void
    reject: (error: Error) => void
  }[] = []
  const input = props({ readPage: vi.fn(() => new Promise<TurnOutlinePage>((resolve, reject) => { pending.push({ resolve, reject }) })) })
  render(<TurnOutline {...input} />)
  fireEvent.change(screen.getByLabelText('Search turns'), { target: { value: 'first' } })
  expect(screen.getByRole('status').textContent).toContain('Loading')
  fireEvent.change(screen.getByLabelText('Search turns'), { target: { value: 'recent' } })
  await act(async () => { pending[0]!.resolve({ turns, total: 31, hasMore: false }) })
  expect(screen.queryByText('First request')).toBeNull()
  await act(async () => { pending[1]!.reject(new Error('offline')) })
  expect(screen.getByRole('alert').textContent).toContain('could not be loaded')
  fireEvent.change(screen.getByLabelText('Search turns'), { target: { value: 'last' } })
  fireEvent.change(screen.getByLabelText('Search turns'), { target: { value: '' } })
  await act(async () => { pending[2]!.reject(new Error('stale')) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('First request')).toBeTruthy()
})
it('leaves the new session unaffected when old navigation rejects', async () => {
  let reject!: (error: Error) => void
  const input = props({ revealTurn: () => new Promise((_done, fail) => { reject = fail }) })
  const view = render(<TurnOutline {...input} />)
  fireEvent.click(screen.getByText('First request'))
  view.rerender(<TurnOutline {...props({ sessionId: SessionId('new-session') })} />)
  await act(async () => { reject(new Error('old navigation failure')) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
})
it('renders untitled and future-status turns and disables navigation without an owner', () => {
  render(<TurnOutline {...props({ revealTurn: undefined, cancelRevealTurn: undefined,
    useProjection: (() => ({ turns: [{ turn: 1, startSeq: 0, preview: '', status: 'future-status' }], total: 1, hasMore: false })) })} />)
  expect(screen.getByText(en.untitled)).toBeTruthy()
  expect(screen.getByText('future-status')).toBeTruthy()
  expect(screen.getByTitle<HTMLButtonElement>(en.open).disabled).toBe(true)
})
it('admits only one navigation when two clicks arrive before React commits the busy state', async () => {
  let resolve!: (result: boolean) => void
  const navigate = vi.fn(() => new Promise<boolean>((done) => { resolve = done }))
  render(<TurnOutline {...props({ revealTurn: navigate })} />)
  const button = screen.getByText('First request').closest('button')!
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(navigate).toHaveBeenCalledOnce()
  await act(async () => { resolve(true) })
  expect(button.disabled).toBe(false)
})
it('keeps the newest page when a page advertises more turns without a cursor', () => {
  const input = props({ useProjection: (() => ({ turns, total: 31, hasMore: true })) })
  render(<TurnOutline {...input} />)
  fireEvent.click(screen.getByText(en.older))
  expect(input.readPage).not.toHaveBeenCalled()
  expect(screen.getByText('First request')).toBeTruthy()
})
