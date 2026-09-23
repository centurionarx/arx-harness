// @vitest-environment jsdom
/**
 * The session-header entry over bound snapshot stores: when it renders, which
 * application is the default, the menu of applications with the default
 * marked, launches from either half, a remembered choice only after a
 * successful pick, failure feedback, icons and their fallback, and the
 * one-gesture-at-a-time guard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@arx-ai/arx-client-test-runtime'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import { OpenInAppAction, type OpenInAppActionProps } from '../src/client/OpenInAppAction.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t = makeTranslate(en) as OpenInAppActionProps['t']
const PNG = 'data:image/png;base64,AAAA'
const SVG = 'data:image/svg+xml;base64,PHN2Zy8+'

interface Bench {
  props: OpenInAppActionProps
  launch: ReturnType<typeof vi.fn>
  choose: ReturnType<typeof vi.fn>
}

function bench(over: {
  apps?: readonly string[] | null
  icons?: Readonly<Record<string, string>>
  choice?: string
  cwd?: string
  launch?: (appId: string, path: string) => Promise<void>
} = {}): Bench {
  const sessions = createSnapshotStore({ byId: over.cwd === undefined ? {} : { s1: { cwd: over.cwd } } })
  const apps = createSnapshotStore<readonly string[] | null>(over.apps ?? null)
  const icons = createSnapshotStore<Readonly<Record<string, string>>>(over.icons ?? {})
  const choice = createSnapshotStore<string>(over.choice ?? '')
  const launch = vi.fn(over.launch ?? (async () => {}))
  const choose = vi.fn()
  const props = {
    sessionId: 's1',
    useSessions: bindSnapshotSelector(sessions),
    useOpenInAppApps: bindSnapshotSelector(apps),
    useOpenInAppIcons: bindSnapshotSelector(icons),
    useOpenInAppChoice: bindSnapshotSelector(choice),
    launch,
    choose,
    t,
  } as unknown as OpenInAppActionProps
  return { props, launch, choose }
}

const mainButton = (app: string): HTMLElement => screen.getByRole('button', { name: `Open in ${app}` })
const moreButton = (): HTMLElement => screen.getByRole('button', { name: en['open.more'] })

describe('OpenInAppAction visibility', () => {
  it('renders nothing before the list arrives, with no applications, without a directory, and for unnamed ids', () => {
    for (const over of [
      { apps: null, cwd: '/w' },
      { apps: [], cwd: '/w' },
      { apps: [], choice: 'vscode', cwd: '/w' },
      { apps: ['vscode'] },
      { apps: ['vscode'], cwd: '' },
      { apps: ['someday-an-app'], cwd: '/w' },
    ] as const) {
      const { container } = render(<OpenInAppAction {...bench(over).props} />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })

  it('defaults to the remembered choice, falling back to the first application when the host no longer offers it', () => {
    render(<OpenInAppAction {...bench({ apps: ['explorer', 'pwsh'], choice: 'pwsh', cwd: '/w' }).props} />)
    expect(mainButton('PowerShell 7')).toBeTruthy()
    cleanup()

    render(<OpenInAppAction {...bench({ apps: ['explorer', 'pwsh'], choice: 'vscode', cwd: '/w' }).props} />)
    expect(mainButton('File Explorer')).toBeTruthy()
  })

  it('omits the chevron when the host offers one application', () => {
    render(<OpenInAppAction {...bench({ apps: ['powershell'], cwd: '/w' }).props} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: en['open.more'] })).toBeNull()
  })

  it('names the default application in the tooltip', async () => {
    render(<OpenInAppAction {...bench({ apps: ['gitbash'], cwd: '/w' }).props} />)
    fireEvent.mouseEnter(mainButton('Git Bash'))
    expect(await screen.findByText('Open in Git Bash', { selector: '[role="tooltip"], div, span' })).toBeTruthy()
  })
})

describe('OpenInAppAction icons', () => {
  it('shows each application icon from the store and the generic glyph without one', () => {
    const view = render(<OpenInAppAction {...bench({
      apps: ['vscode', 'powershell'], icons: { vscode: PNG }, cwd: '/w',
    }).props} />)
    expect(mainButton('VS Code').querySelector('img')?.getAttribute('src')).toBe(PNG)
    fireEvent.click(moreButton())
    const [vscode, powershell] = screen.getAllByRole('menuitem')
    expect(vscode!.querySelector('img')?.getAttribute('src')).toBe(PNG)
    expect(powershell!.querySelector('img')).toBeNull()
    expect(powershell!.querySelector('svg')).not.toBeNull()
    view.unmount()
  })

  it('falls back to the generic glyph when an icon fails to load, and retries a changed source', () => {
    const b = bench({ apps: ['vscode'], icons: { vscode: PNG }, cwd: '/w' })
    const view = render(<OpenInAppAction {...b.props} />)
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('svg')).not.toBeNull()

    view.rerender(<OpenInAppAction {...bench({ apps: ['vscode'], icons: { vscode: SVG }, cwd: '/w' }).props} />)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(SVG)
  })
})

describe('OpenInAppAction launching', () => {
  it('launches the default from the main half without changing the remembered choice', async () => {
    const b = bench({ apps: ['explorer', 'gitbash'], cwd: "C:\\Users\\O'Neil\\My Project" })
    render(<OpenInAppAction {...b.props} />)
    await act(async () => { fireEvent.click(mainButton('File Explorer')) })
    expect(b.launch).toHaveBeenCalledWith('explorer', "C:\\Users\\O'Neil\\My Project")
    expect(b.choose).not.toHaveBeenCalled()
  })

  it('lists every application with the default marked, and remembers a successful pick', async () => {
    const b = bench({ apps: ['explorer', 'powershell', 'pwsh', 'gitbash'], choice: 'gitbash', cwd: '/w/dir' })
    render(<OpenInAppAction {...b.props} />)
    fireEvent.click(moreButton())
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'File Explorer', 'Windows PowerShell', 'PowerShell 7', 'Git Bash (default)',
    ])
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Windows PowerShell' })) })
    expect(b.launch).toHaveBeenCalledWith('powershell', '/w/dir')
    expect(b.choose).toHaveBeenCalledWith('powershell')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('announces a failed launch without remembering the pick', async () => {
    const b = bench({ apps: ['explorer', 'vscode'], cwd: '/w', launch: async () => { throw new Error('gone') } })
    render(<OpenInAppAction {...b.props} />)
    fireEvent.click(moreButton())
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'VS Code' })) })
    expect(screen.getByText(en['open.error'])).toBeTruthy()
    expect(b.choose).not.toHaveBeenCalled()
  })

  it('lets the failure banner fade and replays it on the next failure', async () => {
    vi.useFakeTimers()
    try {
      const b = bench({ apps: ['vscode'], cwd: '/w', launch: async () => { throw new Error('gone') } })
      render(<OpenInAppAction {...b.props} />)
      await act(async () => { fireEvent.click(mainButton('VS Code')) })
      expect(screen.getByText(en['open.error'])).toBeTruthy()
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
      expect(screen.queryByText(en['open.error'])).toBeNull()
      await act(async () => { fireEvent.click(mainButton('VS Code')) })
      expect(screen.getByText(en['open.error'])).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('disables both halves until the launch settles, so a second gesture cannot start', async () => {
    const pending = Promise.withResolvers<undefined>()
    const b = bench({ apps: ['explorer', 'vscode'], cwd: '/w', launch: () => pending.promise })
    const view = render(<OpenInAppAction {...b.props} />)
    fireEvent.click(mainButton('File Explorer'))
    expect(mainButton('File Explorer')).toHaveProperty('disabled', true)
    expect(moreButton()).toHaveProperty('disabled', true)
    expect(view.container.querySelector('[data-open-in-app]')?.getAttribute('data-state')).toBe('busy')
    fireEvent.click(mainButton('File Explorer'))
    expect(b.launch).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(undefined) })
    expect(mainButton('File Explorer')).toHaveProperty('disabled', false)
    expect(view.container.querySelector('[data-open-in-app]')?.getAttribute('data-state')).toBe('idle')
  })

  it('closes the menu on Escape and on a second chevron click without launching', () => {
    const b = bench({ apps: ['explorer', 'vscode'], cwd: '/w' })
    render(<OpenInAppAction {...b.props} />)
    fireEvent.click(moreButton())
    expect(moreButton().getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(moreButton())
    fireEvent.click(moreButton())
    expect(screen.queryByRole('menu')).toBeNull()
    expect(b.launch).not.toHaveBeenCalled()
  })
})
