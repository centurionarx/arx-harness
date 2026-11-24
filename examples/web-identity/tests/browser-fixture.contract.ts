/** Private test-control metadata. No Node implementation or Cordis service face. */
interface BrowserFixture {
  readonly url: string
  readonly adminUrl?: string
  readonly audience: 'user' | 'admin'
  readonly masterPassword: string
  readonly users: ReadonlyArray<{ readonly username: string; readonly password: string }>
  readonly resolution?: { readonly packages: readonly string[]; readonly fixtureOnly: true }
  /** Milliseconds from the server process start: module load, harness start, and ready; `seeded` when it copied the per-run seed. */
  readonly timing?: { readonly loadedMs: number; readonly harnessMs: number; readonly readyMs: number; readonly seeded: boolean }
}
/** Loopback address and bearer token of the per-run identity seed that `identity-seed.global.ts` serves. */
export interface IdentitySeedAddress {
  readonly url: string
  readonly token: string
}
/** Environment variable that hands the seed address to the fixture server process. */
export const IDENTITY_SEED_ENV = 'ARX_TEST_IDENTITY_SEED'
export interface BrowserFixtureControl extends BrowserFixture {
  command(type: string, fields?: object): Promise<Record<string, unknown>>
  close(): Promise<void>
}
export type BrowserFixtureFactory = (
  audience: 'user' | 'admin', firstPassword?: boolean, frontend?: boolean, projectRuntime?: boolean, seed?: IdentitySeedAddress,
) => Promise<BrowserFixtureControl>
