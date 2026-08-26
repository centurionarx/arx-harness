// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllEnvs()
})

describe('DocumentTitle', () => {
  it('projects a durable title and restores the product title', () => {
    vi.stubEnv('ARX_CLIENT_TITLE', 'arx Harness')
    document.title = 'stale title'
    const mounted = render(<DocumentTitle />)
    expect(document.title).toBe('arx Harness')
    mounted.rerender(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — arx Harness')
    mounted.rerender(<DocumentTitle title="Revised title" />)
    expect(document.title).toBe('Revised title — arx Harness')
    mounted.rerender(<DocumentTitle />)
    expect(document.title).toBe('arx Harness')
    mounted.unmount()
    expect(document.title).toBe('arx Harness')
  })

  it('uses the generic title when the build provides no title', () => {
    vi.stubEnv('ARX_CLIENT_TITLE', '')
    delete process.env.ARX_CLIENT_TITLE
    const mounted = render(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — ARX Local Build')
    mounted.unmount()
    expect(document.title).toBe('ARX Local Build')
  })
})
