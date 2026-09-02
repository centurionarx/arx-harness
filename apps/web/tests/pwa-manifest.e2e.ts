import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'arx Harness',
    short_name: 'ARX',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/favicon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    }],
  })
})

it('ships a favicon carrying the full brand logo that swaps palette under a dark scheme', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The brand eye is raster-only, so the SVG seat embeds one PNG per theme:
  // the light artwork renders by default and the style block swaps the pair.
  expect(favicon).toContain('<image class="light" href="data:image/png;base64,')
  expect(favicon).toContain('<image class="dark" href="data:image/png;base64,')
  expect(favicon).toMatch(/\.dark\s*{\s*display:\s*none;\s*}/i)
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*\.light\s*{\s*display:\s*none;\s*}/i)
  // The wordmark rides the seat at the eye's width, same ink pair and plate
  // geometry as BrandWordmark, with the deep blue tone swapping on dark.
  expect(favicon).toContain('>HARNESS</text>')
  expect(favicon).toContain('class="plate"')
  expect(favicon).toContain('stroke: #0b4c9e')
})
