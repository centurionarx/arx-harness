/**
 * Schedule catalog stylesheet contract, asserted against the CSS text on disk.
 *
 * A custom property the theme never declares has no fallback: every
 * declaration that reads it is invalid at computed-value time and dropped, so
 * the menu renders without its surface, label colors, shadow, or themed
 * scrollbar while the sheet still parses and the DOM is unchanged.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/ScheduleCatalogAction.module.css', import.meta.url)),
  'utf8',
)
// Every theme sheet, not only the platform tokens: shadow and scrollbar
// variables are declared in sibling files.
const tokens = readdirSync(fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

/** Custom properties the sheet declares itself, which its own `var()` reads may name. */
const local = [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(match => String(match[1]))

describe('ScheduleCatalogAction theme styles', () => {
  it('reads only variables the theme sheets or the sheet itself declare', () => {
    // Every prefix is matched, so a name from an older token set is reported as
    // undeclared instead of slipping past a prefix filter.
    const named = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map(match => String(match[1]))
    expect(named.length).toBeGreaterThan(5)
    const undeclared = [...new Set(named)].filter(name => !tokens.includes(`  ${name}:`) && !local.includes(name))
    expect(undeclared).toEqual([])
  })

  it('rebinds exactly the scrollbar variables the theme scrollbar reads', () => {
    const scrollbar = local.filter(name => name.includes('scrollbar'))
    expect(scrollbar).toEqual(['--arx-scrollbar-thumb', '--arx-scrollbar-thumb-hover'])
    for (const name of scrollbar) expect(tokens).toMatch(new RegExp(`var\\(${name}[,)\\s]`))
  })
})
