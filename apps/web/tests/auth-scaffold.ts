// Authenticated AUTH composition for the keyless browser lane. The shipped
// `arx web` composition that scaffold.ts boots has no web identity, owner
// project storage or isolated project runtime, so the AUTH journeys run
// against the disposable identity fixture server of examples/web-identity
// (browser-server.host.ts): real identity, cookies, CSRF, project storage,
// isolated runtime, the native test supervisor with in-process workers and
// the built frontend from apps/web/dist. Sessions are seeded with a
// hand-built conversation through the fixture's `seed-history` command, so no
// model is called and no recording exists; `worker-counts` proves it. The
// fixture's in-process worker composition resolves its packages through the
// NODE_PATH that the pnpm `vitest` bin sets.
import type { Browser, BrowserContext, Page } from 'playwright'
import { browserFixture } from '../../../examples/web-identity/tests/browser-fixture.host.ts'
import type { BrowserFixtureControl } from '../../../examples/web-identity/tests/browser-fixture.contract.ts'

/** One running authenticated USER deployment with a project runtime, as the fixture serves it. */
export interface AuthWebScaffold {
  readonly fixture: BrowserFixtureControl
  /** Owned project and session the fixture seeded for USER `index`; the session is titled `Conversa privada <index>`. */
  seed(index: number): Promise<{ projectId: string; title: string }>
  /** Model and tool calls the supervisor's workers made so far. */
  workerCounts(): Promise<{ modelCalls: number; toolCalls: number }>
  close(): Promise<void>
}

/**
 * Launch the authenticated USER fixture with the built frontend and the project runtime.
 * Requires `pnpm run build` (apps/web/dist) and the repository root as working directory.
 * @returns the running deployment and its fixture commands.
 */
export async function launchAuthWebScaffold(): Promise<AuthWebScaffold> {
  const fixture = await browserFixture('user', false, true, true)
  return {
    fixture,
    async seed(index) {
      const { projectId } = await fixture.command('seed-history', { index })
      if (typeof projectId !== 'string') throw new Error('auth scaffold: seed-history returned no project id')
      return { projectId, title: 'Conversa privada ' + String(index) }
    },
    async workerCounts() {
      const counts = await fixture.command('worker-counts')
      return { modelCalls: Number(counts.modelCalls), toolCalls: Number(counts.toolCalls) }
    },
    close: () => fixture.close(),
  }
}

/**
 * Open a Brazilian Portuguese browser context and page on the fixture origin, as the identity gates do.
 * @param browser - Playwright browser owning the context.
 * @param origin - fixture USER origin.
 * @param onPageError - called for every uncaught page error, from the first navigation on.
 * @returns the context and its page at the public sign-in screen.
 */
export async function openAuthPage(browser: Browser, origin: string,
  onPageError: () => void): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  page.on('pageerror', onPageError)
  await page.goto(origin)
  await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor({ timeout: 30_000 })
  return { context, page }
}

/**
 * Sign in through the real form. A failed fill rethrows only the error class: Playwright's error message quotes the
 * filled value, and the test runner prints that message.
 * @param page - page at the sign-in screen.
 * @param user - fixture USER credentials.
 * @param user.username - fixture user name.
 * @param user.password - fixture password.
 */
export async function signIn(page: Page, user: { readonly username: string; readonly password: string }): Promise<void> {
  try {
    await page.getByLabel('Nome de usuário ou e-mail').fill(user.username)
    await page.getByLabel('Senha', { exact: true }).fill(user.password)
  } catch (error) {
    throw new Error('auth scaffold: sign-in form fill failed (' + (error instanceof Error ? error.name : 'unknown') + ')')
  }
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
}

/**
 * Select one owned project in the USER navigation.
 * @param page - signed-in USER page.
 * @param projectId - owned project id.
 */
export async function openOwnProject(page: Page, projectId: string): Promise<void> {
  const select = page.getByRole('combobox', { name: 'Meus projetos' })
  const toggle = page.getByRole('button', { name: 'Meus projetos', exact: true })
  await select.or(toggle).first().waitFor({ timeout: 30_000 })
  if (await select.count() === 0) await toggle.click()
  await select.selectOption(projectId)
}

/**
 * The project history row of one session.
 * @param page - signed-in USER page with the project open.
 * @param title - session title.
 * @returns the row locator.
 */
export function sessionRow(page: Page, title: string) {
  return page.locator('li').filter({ has: page.getByText(title, { exact: true }) })
}
