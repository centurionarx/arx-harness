// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as primitives from '@arx-ai/arx-client-ui-primitives'
import {
  IconApiOutline14, IconArchiveOutline20, IconFolderClose16, IconGoalOutline16, IconSendOutline16,
} from '@arx-ai/arx-client-ui-primitives'

afterEach(cleanup)

// Icon components all share the IconProps signature; the barrel also exports
// non-icon atoms (different props shapes), so filter by prefix BEFORE typing.
const icons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('Icon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
const iconNames = Object.keys(icons)

describe('ic_ds_ icon set', () => {
  it('exports the full icon set (46 deepsuite + 20 figma extracts + four product glyphs outside those sets)', () => {
    expect(iconNames.length).toBe(70)
  })

  it.each(iconNames)('%s renders an svg with currentColor fills and no hardcoded palette', (name) => {
    const Icon = icons[name]!
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const markup = container.innerHTML
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
    expect(markup).toContain('currentColor')
  })

  it('size and className props land on the root svg', () => {
    const { container } = render(<IconSendOutline16 size={20} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.classList.contains('x')).toBe(true)
  })

  it('each glyph defaults to its own drawn size, not one set-wide default', () => {
    const api = render(<IconApiOutline14 />)
    expect(api.container.querySelector('svg')!.getAttribute('width')).toBe('14')
    const folder = render(<IconFolderClose16 />)
    expect(folder.container.querySelector('svg')!.getAttribute('width')).toBe('16')
    const archive = render(<IconArchiveOutline20 />)
    expect(archive.container.querySelector('svg')!.getAttribute('width')).toBe('20')
  })

  it('renders reusable goal glyphs without document-global ids', () => {
    const { container } = render(<><IconGoalOutline16 /><IconGoalOutline16 /></>)
    expect(container.querySelector('[id]')).toBeNull()
    expect(container.querySelector('[clip-path]')).toBeNull()
  })
})

describe('BrandMark', () => {
  it('keeps the artwork proportion and carries a theme-swapped background', () => {
    const { container } = render(<primitives.BrandMark size={34} />)
    const mark = container.querySelector('span')!
    expect(mark.style.width).toBe('34px')
    // 253:136 native artwork.
    expect(mark.style.height).toBe(`${34 / (253 / 136)}px`)
    expect(mark.getAttribute('aria-hidden')).toBe('true')
    expect(mark.className).not.toBe('')
  })

  it('keeps its own class when a layout class is supplied', () => {
    const { container } = render(<primitives.BrandMark className="seat" />)
    const mark = container.querySelector('span')!
    expect(mark.className.split(' ')).toContain('seat')
    expect(mark.className.split(' ').length).toBe(2)
  })
})

describe('BrandWordmark', () => {
  it('sets the word in two blues and keeps its footprint under a font fallback', () => {
    const view = render(<primitives.BrandWordmark />)
    const svg = view.container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('180')
    expect(svg.getAttribute('viewBox')).toBe('0 0 180 34')

    const [word, plate] = [...svg.querySelectorAll('text')]
    expect(plate?.textContent).toBe('HARNESS')
    // Pinned advance width: a fallback face may draw other glyph shapes, but it
    // cannot change how much room the wordmark takes in the layout.
    expect(word?.getAttribute('textLength')).toBe('80')
    expect(plate?.getAttribute('textLength')).toBe('64')
    const [first, second] = [...(word?.querySelectorAll('tspan') ?? [])]
    expect(first?.textContent).toBe('a')
    expect(second?.textContent).toBe('rx')
    expect(first?.getAttribute('class')).not.toBe(second?.getAttribute('class'))
  })

  it('scales width with the requested height', () => {
    const view = render(<primitives.BrandWordmark size={17} />)
    const svg = view.container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('90')
    expect(svg.getAttribute('height')).toBe('17')
  })
})
