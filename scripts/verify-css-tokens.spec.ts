import { describe, expect, it } from 'vitest'

import { declaredProperties, declaresProperties, findUndeclaredReads } from './verify-css-tokens.ts'

describe('declaresProperties', () => {
  it('reads stylesheets and product TypeScript anywhere outside documentation and vendored roots', () => {
    for (const path of ['packages/client/ui-theme/src/styles/tokens.css', 'packages/extensions/ui-cordis/src/client/Panel.module.css',
      'packages/client/ui-layout/src/client/Row.tsx', 'apps/web/src/main.ts']) expect(declaresProperties(path)).toBe(true)
  })

  it('leaves out tests, specs, type declarations, other files, and documentation or vendored roots', () => {
    for (const path of ['packages/client/ui-schedule/tests/styles.client.spec.ts', 'packages/client/ui-x/src/a.spec.tsx',
      'packages/client/ui-x/src/a.test.ts', 'packages/client/ui-x/lib/types/index.d.ts', 'packages/client/ui-x/README.md',
      'website/.vitepress/theme/custom.css', 'vendor/hmr/src/index.ts', 'docs/user/guide/style.css']) {
      expect(declaresProperties(path)).toBe(false)
    }
  })
})

describe('declaredProperties', () => {
  it('collects CSS declarations, including a rebinding inside a rule, and skips commented-out ones', () => {
    const css = ':root {\n  --arx-alias-label-primary: #000;\n  /* --arx-retired: #fff; */\n}\n.menu {\n  --arx-scrollbar-thumb: var(--arx-alias-label-primary);\n}\n'
    expect(declaredProperties('theme.css', css)).toEqual(new Set(['--arx-alias-label-primary', '--arx-scrollbar-thumb']))
  })

  it('collects inline-style keys and setProperty arguments, not reads, getPropertyValue, or array literals', () => {
    const tsx = [
      "const style = { '--row-indent': `${depth}px` }",
      "node.style.setProperty('--panel-height', height)",
      "const read = 'var(--arx-read-only)'",
      "getComputedStyle(node).getPropertyValue('--arx-measured')",
      "const names = ['--arx-listed', '--arx-other']",
    ].join('\n')
    expect(declaredProperties('Row.tsx', tsx)).toEqual(new Set(['--row-indent', '--panel-height']))
  })
})

describe('findUndeclaredReads', () => {
  const declared = new Set(['--arx-alias-label-primary', '--row-indent'])

  it('rejects a fallback-free read of an undeclared property, naming its line', () => {
    const css = '.label {\n  color: var(--arx-alias-label-primary);\n  background: var( --arx-alias-fill-l2 );\n}\n'
    expect(findUndeclaredReads('ui/Label.module.css', css, declared)).toEqual([
      'ui/Label.module.css:3: reads --arx-alias-fill-l2, which no client stylesheet or inline style declares',
    ])
  })

  it('accepts declared reads, a property declared by TypeScript, a read with a fallback, and a commented-out read', () => {
    const css = '.row {\n  padding-left: var(--row-indent);\n  color: var(--arx-alias-label-primary);\n  font-family: var(--arx-font-mono, monospace);\n  /* color: var(--arx-retired); */\n}\n'
    expect(findUndeclaredReads('ui/Row.module.css', css, declared)).toEqual([])
  })
})
