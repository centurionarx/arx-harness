/** External GitHub-only responses; every other fetch keeps its native implementation. */
const SENTINEL = 'synthetic-repository-example-PAT-not-a-real-token'

/** Install bounded external responses, with no credential or production API substitution.
 * @returns Synthetic answer, recorded GETs and the native-fetch restoration callback.
 */
export function installGithubFetchFixture() {
  const nativeFetch = globalThis.fetch
  const requests: string[] = []
  let unauthorized = false
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== 'https://api.github.com') return nativeFetch(input, init)
    if (init?.method !== 'GET' || init.redirect !== 'error') throw new Error('External GitHub fixture requires redirect-refusing GET')
    if (new Headers(init.headers).get('Authorization') !== 'Bearer ' + SENTINEL) throw new Error('External GitHub fixture requires the synthetic answer')
    requests.push(url.pathname + url.search)
    if (unauthorized) return Response.json({ message: 'Invalid synthetic credential' }, { status: 401 })
    if (url.pathname === '/user' && url.search === '') return Response.json({ id: 7, login: 'example-reader', html_url: 'https://github.com/example-reader' })
    if (url.pathname !== '/user/repos' || url.searchParams.get('per_page') !== '1'
      || url.searchParams.get('sort') !== 'full_name' || url.searchParams.get('direction') !== 'asc'
      || [...url.searchParams.keys()].sort().join(',') !== 'direction,page,per_page,sort') throw new Error('Unexpected external GitHub endpoint')
    const page = url.searchParams.get('page')
    if (page !== '1' && page !== '2') throw new Error('Unexpected external GitHub page')
    const name = page === '1' ? 'first' : 'second'
    return Response.json([{ id: page === '1' ? 11 : 12, owner: { login: 'example-reader' }, name,
      private: page === '2', default_branch: page === '1' ? '<img src=x onerror=alert(1)> & branch' : 'inspection',
      html_url: 'https://github.com/example-reader/' + name }], { headers: { Link: '<https://api.github.com/unsupported>; rel="next"' } })
  }
  return { sentinel: SENTINEL, requests,
    rejectCredential: () => { unauthorized = true },
    restore: () => { globalThis.fetch = nativeFetch } }
}
