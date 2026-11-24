import { describe, expect, it } from 'vitest'

import { declaredProperties, findUndeclaredReads } from './verify-css-tokens.ts'

describe('declaredProperties', () => {
  it('collects CSS declarations, including a rebinding inside a rule', () => {
    const css = ':root {\n  --arx-alias-label-primary: #000;\n}\n.menu {\n  --arx-scrollbar-thumb: var(--arx-alias-label-primary);\n}\n'
    expect(declaredProperties('theme.css', css)).toEqual(new Set(['--arx-alias-label-primary', '--arx-scrollbar-thumb']))
  })

  it('collects inline-style keys and setProperty arguments from TypeScript, not var() reads', () => {
    const tsx = "const style = { '--row-indent': `${depth}px` }\nnode.style.setProperty('--panel-height', height)\nconst read = 'var(--arx-read-only)'\n"
    expect(declaredProperties('Row.tsx', tsx)).toEqual(new Set(['--row-indent', '--panel-height']))
  })
})

describe('findUndeclaredReads', () => {
  const declared = new Set(['--arx-alias-label-primary', '--row-indent'])

  it('rejects a fallback-free read of an undeclared property, naming its line', () => {
    const css = '.label {\n  color: var(--arx-alias-label-primary);\n  background: var(--arx-alias-fill-l2);\n}\n'
    expect(findUndeclaredReads('ui/Label.module.css', css, declared)).toEqual([
      'ui/Label.module.css:3: reads --arx-alias-fill-l2, which no client stylesheet or inline style declares',
    ])
  })

  it('rejects an undeclared name under any prefix', () => {
    expect(findUndeclaredReads('a.css', '.a { color: var(--dsw-alias-label-primary); }', declared)).toHaveLength(1)
  })

  it('accepts declared reads, a property declared by TypeScript, and a read with a fallback', () => {
    const css = '.row {\n  padding-left: var(--row-indent);\n  color: var(--arx-alias-label-primary);\n  font-family: var(--arx-font-mono, monospace);\n}\n'
    expect(findUndeclaredReads('ui/Row.module.css', css, declared)).toEqual([])
  })
})
