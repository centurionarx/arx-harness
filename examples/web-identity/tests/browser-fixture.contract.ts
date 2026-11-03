/** Private test-control metadata. No Node implementation or Cordis service face. */
interface BrowserFixture {
  readonly url: string
  readonly adminUrl?: string
  readonly audience: 'user' | 'admin'
  readonly masterPassword: string
  readonly users: ReadonlyArray<{ readonly username: string; readonly password: string }>
  readonly resolution?: { readonly packages: readonly string[]; readonly fixtureOnly: true }
}
export interface BrowserFixtureControl extends BrowserFixture {
  command(type: string, fields?: object): Promise<Record<string, unknown>>
  close(): Promise<void>
}
export type BrowserFixtureFactory = (
  audience: 'user' | 'admin', firstPassword?: boolean, frontend?: boolean, projectRuntime?: boolean,
) => Promise<BrowserFixtureControl>
