// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DropOverlay } from '../src/DropOverlay.tsx'

afterEach(cleanup)

describe('DropOverlay', () => {
  it('portals the invitation with its title and limits desc to the body', () => {
    const view = render(
      <DropOverlay disabled={false} labels={{ title: '图片拖动到此处即可添加', desc: '最多 20 张，每张 5MB' }} />,
    )
    const overlay = view.getByRole('status')
    expect(overlay.parentElement).toBe(document.body)
    expect(overlay.textContent).toContain('图片拖动到此处即可添加')
    expect(overlay.textContent).toContain('最多 20 张，每张 5MB')
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
    const view = render(<DropOverlay disabled={false} labels={{ title: '图片拖动到此处即可添加' }} />)
    expect(view.getByRole('status').textContent).toBe('图片拖动到此处即可添加')
  })

  it('drops the desc and switches the illustration while disabled', () => {
    const enabled = render(
      <DropOverlay disabled={false} labels={{ title: '拖入', desc: '限制' }} />,
    )
    const enabledSvg = enabled.getByRole('status').querySelector('svg')!.innerHTML
    enabled.unmount()
    const disabled = render(
      <DropOverlay disabled labels={{ title: '当前无法添加图片', desc: '限制' }} />,
    )
    const overlay = disabled.getByRole('status')
    expect(overlay.textContent).toBe('当前无法添加图片')
    expect(overlay.querySelector('svg')!.innerHTML).not.toBe(enabledSvg)
  })
})
