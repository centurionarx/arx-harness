// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DropOverlay } from '../src/DropOverlay.tsx'

afterEach(cleanup)

describe('DropOverlay', () => {
  it('portals the invitation with its title and limits desc to the body', () => {
    const view = render(
      <DropOverlay disabled={false} labels={{ title: 'Arraste imagens para cá para adicioná-las', desc: 'Até 20 imagens, 5MB cada' }} />,
    )
    const overlay = view.getByRole('status')
    expect(overlay.parentElement).toBe(document.body)
    expect(overlay.textContent).toContain('Arraste imagens para cá para adicioná-las')
    expect(overlay.textContent).toContain('Até 20 imagens, 5MB cada')
  })

  it('names the invitation independently of other page status regions', () => {
    const view = render(<>
      <p role="status">Repository metadata is cold</p>
      <DropOverlay disabled={false} labels={{ title: 'Drag images here to add them', desc: 'Up to 20 images, 5MB each' }} />
    </>)
    const overlay = view.getByRole('status', { name: 'Drag images here to add them' })
    expect(overlay.parentElement).toBe(document.body)
    expect(overlay.textContent).toContain('Up to 20 images, 5MB each')
    expect(view.getByText('Repository metadata is cold').getAttribute('role')).toBe('status')
  })

  it('omits the desc line when none is resolved', () => {
    const view = render(<DropOverlay disabled={false} labels={{ title: 'Arraste imagens para cá para adicioná-las' }} />)
    expect(view.getByRole('status').textContent).toBe('Arraste imagens para cá para adicioná-las')
  })

  it('drops the desc and switches the illustration while disabled', () => {
    const enabled = render(
      <DropOverlay disabled={false} labels={{ title: 'Solte aqui', desc: 'Limites' }} />,
    )
    const enabledSvg = enabled.getByRole('status').querySelector('svg')!.innerHTML
    enabled.unmount()
    const disabled = render(
      <DropOverlay disabled labels={{ title: 'Não é possível adicionar imagens agora', desc: 'Limites' }} />,
    )
    const overlay = disabled.getByRole('status')
    expect(overlay.textContent).toBe('Não é possível adicionar imagens agora')
    expect(overlay.querySelector('svg')!.innerHTML).not.toBe(enabledSvg)
  })
})
