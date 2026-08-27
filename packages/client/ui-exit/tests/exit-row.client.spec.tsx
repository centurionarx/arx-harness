// @vitest-environment jsdom
/** The exit row's four phases: idle, confirming, stopping, and refused. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ExitRowProps } from '../src/client/ExitRow.tsx'
import { ExitRow } from '../src/client/ExitRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is exit ∪ common; the stub answers from the package
// dictionary and falls back to the key like the real chain.
const t: ExitRowProps['t'] = key => (en as Record<string, string>)[key] ?? key

/** Standard kit stubs: this component consumes no framework hook. */
const unusedHook = (() => { throw new Error('unused by the exit row') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }

function row(stop: ExitRowProps['stop'], wide = true) {
  return render(<ExitRow {...kit} wide={wide} stop={stop} t={t} />)
}

/** The row's own button. The dialog's primary action names the consequence
 * ("Stop the server") rather than repeating "Exit", so the two never collide
 * in the accessibility tree while both are on screen. */
const trigger = () => screen.getByRole('button', { name: /Exit/ })

describe('ExitRow', () => {
  it('renders the icon with the label in the wide column', () => {
    const { container } = row(() => Promise.resolve(true))
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Exit')).toBeTruthy()
  })

  it('drops the label in the rail state', () => {
    const { container } = row(() => Promise.resolve(true), false)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('Exit')).toBeNull()
  })

  it('asks nothing until the confirmation is accepted', () => {
    const stop = vi.fn(() => Promise.resolve(true))
    row(stop)
    fireEvent.click(trigger())
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(stop).not.toHaveBeenCalled()
  })

  it('cancelling closes the dialog and leaves the harness running', () => {
    const stop = vi.fn(() => Promise.resolve(true))
    row(stop)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(stop).not.toHaveBeenCalled()
  })

  it('closing the dialog without answering leaves the harness running', () => {
    const stop = vi.fn(() => Promise.resolve(true))
    row(stop)
    fireEvent.click(trigger())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(stop).not.toHaveBeenCalled()
  })

  it('accepting asks once and stays stopping, because the page is going', async () => {
    const stop = vi.fn(() => Promise.resolve(true))
    row(stop)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: 'Stop the server' }))
    await waitFor(() => { expect(screen.getByText('Stopping…')).toBeTruthy() })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /Stopping/ })).toHaveProperty('disabled', true)
  })

  it('reports a deployment whose launcher provided no shutdown', async () => {
    const stop = vi.fn(() => Promise.resolve(false))
    row(stop)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: 'Stop the server' }))
    await waitFor(() => {
      expect(screen.getByText('This deployment offers no way to exit')).toBeTruthy()
    })
    // The refusal reuses the dialog without its answer buttons: there is
    // nothing left to accept.
    expect(screen.queryByText('Cancel')).toBeNull()
  })
})
