// @vitest-environment jsdom
/**
 * `useDismissOnOutsidePointer`: an open popover closes on a pointerdown outside
 * its root, and a surface portaled out of that root still counts as inside.
 */
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useDismissOnOutsidePointer } from '../src/useDismissOnOutsidePointer.ts'

afterEach(cleanup)

/**
 * Popover host whose panel optionally lives in a `document.body` portal.
 * @param props - open state, its setter, and whether the panel is portaled.
 * @returns the root with its trigger, the panel, and an unrelated element.
 */
function Host({ open, setOpen, portaled }: {
  open: boolean
  setOpen: (open: boolean) => void
  portaled: boolean
}) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useDismissOnOutsidePointer(rootRef, open, setOpen, portaled ? panelRef : undefined)
  const panel = <div ref={panelRef} data-testid="panel">panel</div>
  return (
    <>
      <span ref={rootRef}>
        <button type="button">trigger</button>
        {!portaled && panel}
      </span>
      {portaled && createPortal(panel, document.body)}
      <p>elsewhere</p>
    </>
  )
}

describe('useDismissOnOutsidePointer', () => {
  it('keeps a portaled panel inside, and closes on any other outside pointerdown', () => {
    const setOpen = vi.fn()
    const ui = render(<Host open setOpen={setOpen} portaled />)

    fireEvent.pointerDown(ui.getByTestId('panel'))
    fireEvent.pointerDown(ui.getByRole('button', { name: 'trigger' }))
    expect(setOpen).not.toHaveBeenCalled()

    fireEvent.pointerDown(ui.getByText('elsewhere'))
    expect(setOpen).toHaveBeenCalledWith(false)
  })

  it('treats the root as the whole popover when no portal is named', () => {
    const setOpen = vi.fn()
    const ui = render(<Host open setOpen={setOpen} portaled={false} />)

    fireEvent.pointerDown(ui.getByTestId('panel'))
    expect(setOpen).not.toHaveBeenCalled()

    fireEvent.pointerDown(ui.getByText('elsewhere'))
    expect(setOpen).toHaveBeenCalledWith(false)
  })

  it('listens only while open', () => {
    const setOpen = vi.fn()
    const ui = render(<Host open={false} setOpen={setOpen} portaled />)

    fireEvent.pointerDown(ui.getByText('elsewhere'))

    expect(setOpen).not.toHaveBeenCalled()
  })
})
