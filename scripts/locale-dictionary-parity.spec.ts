/**
 * Gate for the client's second locale: every Brazilian Portuguese (`pt`)
 * dictionary declares exactly the keys of its English (`en`) counterpart, and
 * every English dictionary without a Portuguese counterpart is named in
 * {@link ENGLISH_ONLY}.
 *
 * The locale runtime resolves a key through the active locale, then through
 * English, then surfaces the key itself. A `pt` dictionary missing a key shows
 * that string in English inside Portuguese text; an extra key is text no
 * surface renders. A namespace registered without `pt` renders all of its
 * text in English, which is allowed only while the namespace is listed here,
 * so the list shows what still needs translation and shrinks as it lands.
 *
 * Discovery is deliberately broad, because a gate that silently narrows is
 * worse than no gate. It sweeps every workspace package, reads dictionaries
 * wherever they are declared (`locales.ts`, a `locales/` directory, or inline
 * in the plugin body), and pairs `en`/`pt` across sibling files as well as
 * within one module. A `pt` dictionary whose `en` counterpart cannot be found
 * is an error, not a skip.
 */

import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

type Locale = 'en' | 'pt'
const LOCALES: readonly Locale[] = ['en', 'pt']

/**
 * English dictionaries that ship without a Portuguese counterpart, as
 * `<repo-relative file>::<dictionary name>`. Adding a `pt` counterpart
 * requires removing the entry; an entry that no longer names an English-only
 * dictionary fails the gate.
 */
const ENGLISH_ONLY: ReadonlySet<string> = new Set([
  'packages/client/ui-commands/src/client/locales.ts::en',
  'packages/client/ui-deliverables/src/client/locales.ts::en',
  'packages/client/ui-directory-picker-browse/src/client/index.ts::en@register:LOCALE_NS',
  'packages/client/ui-exit/src/client/locales.ts::en',
  'packages/client/ui-file-preview/src/client/locales.ts::en',
  'packages/client/ui-goal/src/client/locales.ts::en',
  'packages/client/ui-input-trigger/src/client/locales.ts::en',
  'packages/client/ui-jobs/src/client/locales.ts::en',
  'packages/client/ui-message-feedback/src/client/locales.ts::en',
  'packages/client/ui-open-in-app/src/client/locales.ts::en',
  'packages/client/ui-plan/src/client/locales.ts::en',
  'packages/client/ui-projects/src/client/locales.ts::en',
  'packages/client/ui-reference/src/client/locales.ts::en',
  'packages/client/ui-settings-general/src/client/locales.ts::en',
  'packages/client/ui-settings-models/src/client/locales.ts::en',
  'packages/client/ui-settings-plugin-inventory/src/client/locales.ts::en',
  'packages/client/ui-settings-plugins/src/client/locales.ts::en',
  'packages/client/ui-settings-web/src/client/locales.ts::en',
  'packages/client/ui-sidebar/src/client/locales.ts::en',
  'packages/client/ui-skill/src/client/locales.ts::en',
  'packages/client/ui-subagent/src/client/locales.ts::en',
  'packages/client/ui-theme/src/client/locales.ts::en',
  'packages/client/ui-trajectory/src/client/locales.ts::en',
  'packages/client/ui-turn-outline/src/client/locales.ts::en',
  'packages/client/ui-workflow-run/src/client/locales.ts::en',
  'packages/client/ui-workspace/src/client/locales.ts::en',
  'packages/extensions/ui-cordis/src/client/locales.ts::en',
  'packages/session-query/session-log-export/src/client/locales.ts::en',
])

/** Repo-relative path with `/` separators, so messages and suffix tests match on every OS. */
function relative(file: string): string {
  return file.slice(root.length).replaceAll('\\', '/')
}

/** Every `.ts`/`.tsx` source file under each workspace package's `src`, excluding declarations. */
function sourceFiles(): string[] {
  const files: string[] = []
  const packagesRoot = resolve(root, 'packages')
  for (const group of directories(packagesRoot)) {
    for (const pkg of directories(resolve(packagesRoot, group))) {
      walk(resolve(packagesRoot, group, pkg, 'src'), files)
    }
  }
  return files.sort()
}

/** Immediate subdirectory names, or none when the path is not a directory. */
function directories(dir: string): string[] {
  return readEntries(dir).filter(entry => entry.isDirectory()).map(entry => entry.name)
}

/**
 * Directory entries, treating only a genuinely absent directory as empty.
 * Any other failure (`EACCES`, I/O) rethrows: silently reading it as "absent"
 * would narrow the sweep and let the gate pass while checking less.
 * @param dir - absolute directory path.
 * @returns entries, or none when the directory does not exist.
 */
function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function walk(dir: string, out: string[]): void {
  for (const entry of readEntries(dir)) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
  }
}

/** One discovered dictionary: which file and export name declared it. */
interface Dictionary {
  /** Repo-relative declaring file. */
  file: string
  /** Export name, or the registration site for an inline literal. */
  name: string
  /** Declared keys, sorted. */
  keys: string[]
}

/**
 * Keys of every top-level `export const <name> = { ... }` object literal whose
 * name identifies a locale dictionary, plus inline `register(ns, locale, {...})`
 * literals. Read from the AST so the gate never executes package code.
 * @param file - absolute path of a candidate module.
 * @returns discovered dictionaries, keyed by locale-bearing name.
 */
function dictionariesIn(file: string): Dictionary[] {
  const text = readFileSync(file, 'utf8')
  // Cheap pre-filter: parsing every package source is wasteful. The pattern
  // must admit every shape `localeOf` accepts, or a file would be skipped
  // before parsing — the silent narrowing this gate exists to prevent. A bare
  // `\b(en|pt)\b` misses `enSettings`/`accessPt`, because `\b` does not hold
  // between `n` and an uppercase letter.
  if (!/\b(en|pt)\b|\b(en|pt)[A-Z]|(En|Pt)\b/.test(text)) return []
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, kind)
  const found: Dictionary[] = []
  const rel = relative(file)

  // Module-scope variable declarations, keyed by name. A 3-arg
  // `register(NS, 'en'|'pt', dict)` whose third argument is an identifier —
  // e.g. a local dictionary variable rather than an inline literal — resolves
  // through here so the gate still verifies its keys.
  const moduleConsts = new Map<string, ts.Expression>()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer !== undefined) {
        moduleConsts.set(decl.name.text, decl.initializer)
      }
    }
  }

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      const literal = unwrap(decl.initializer)
      if (literal === undefined || !ts.isObjectLiteralExpression(literal)) continue
      if (localeOf(decl.name.text) === undefined) continue
      found.push({ file: rel, name: decl.name.text, keys: keysOf(literal) })
    }
  }

  // A 3-arg `register(ns, 'en'|'pt', dict)` call whose dictionary argument
  // cannot be turned into an object literal. The gate refuses instead of
  // skipping: a registration it cannot measure is exactly the silent
  // narrowing it exists to catch.
  const refuse = (ns: string, tag: string, why: string): never => {
    throw new Error(`cannot verify register('${ns}', '${tag}', ...) in ${rel}: ${why}`)
  }

  // Inline `register(NS, 'en', {...})` / `register(NS, 'pt', {...})` calls key
  // off the namespace argument, so the two calls for one namespace pair with
  // each other.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee) && callee.text === 'register' ? 'register' : undefined
      if (name === 'register' && node.arguments.length >= 3) {
        const [ns, tag, dict] = node.arguments
        if (ns !== undefined && tag !== undefined && ts.isStringLiteral(tag) && isLocale(tag.text)) {
          const raw = unwrap(dict)
          const literal = raw !== undefined && ts.isIdentifier(raw)
            ? unwrap(moduleConsts.get(raw.text))
            : raw
          if (literal === undefined || !ts.isObjectLiteralExpression(literal)) {
            refuse(ns.getText(source), tag.text, raw !== undefined && ts.isIdentifier(raw)
              ? `third argument ${raw.text} does not resolve to an inline or module-scope object literal`
              : 'third argument is neither an object literal nor a resolvable dictionary variable')
          }
          const dictionary = literal as ts.ObjectLiteralExpression
          found.push({ file: rel, name: `${tag.text}@register:${ns.getText(source)}`, keys: keysOf(dictionary) })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function isLocale(tag: string): tag is Locale {
  return (LOCALES as readonly string[]).includes(tag)
}

/** Declared property names of an object literal, sorted. */
function keysOf(literal: ts.ObjectLiteralExpression): string[] {
  const keys: string[] = []
  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) keys.push(prop.name.text)
  }
  return keys.sort()
}

/** Look through `satisfies`/`as`/parenthesized wrappers to the literal. */
function unwrap(node: ts.Expression | undefined): ts.Expression | undefined {
  let current = node
  while (
    current !== undefined
    && (ts.isSatisfiesExpression(current) || ts.isAsExpression(current) || ts.isParenthesizedExpression(current))
  ) {
    current = current.expression
  }
  return current
}

/**
 * The locale a dictionary name declares, and the namespace-ish remainder that
 * identifies which pair it belongs to. `en`/`pt`, `enSettings`/`ptSettings`,
 * and `accessEn`/`accessPt` are the shapes this repo uses. A name-prefix shape
 * requires an uppercase ASCII letter at the third position, matching the
 * admission of the cheap pre-filter, so `en2Foo`/`pt_probe` cannot be treated
 * as dictionaries in one place and skipped in another.
 * @param name - export name or synthetic inline name.
 * @returns locale plus pair key, or undefined when the name names no locale.
 */
function localeOf(name: string): { locale: Locale; pair: string } | undefined {
  for (const locale of LOCALES) {
    const suffix = locale === 'en' ? 'En' : 'Pt'
    if (name === locale) return { locale, pair: '' }
    // Synthetic names for inline shapes carry their own pair key after the
    // first ':' (the namespace expression).
    if (name.startsWith(`${locale}@`)) return { locale, pair: name.slice(name.indexOf(':')) }
    if (name.startsWith(locale) && name.length > 2 && /[A-Z]/.test(name[2] ?? '')) {
      return { locale, pair: name.slice(2) }
    }
    if (name.endsWith(suffix)) return { locale, pair: name.slice(0, -2) }
  }
  return undefined
}

describe('shipped locale dictionaries', () => {
  it('declares the English keys in every Portuguese dictionary and lists every English-only one', () => {
    const files = sourceFiles()
    // Guard the discovery itself: an empty or narrowed sweep would pass every
    // assertion below while checking nothing.
    expect(files.length).toBeGreaterThan(500)

    // Pair within a file first; a dictionary whose counterpart is not in the
    // same module then pairs with a sibling in the same directory. Both shapes
    // ship here: `locales/settings.ts` exports en+pt together, while
    // `locales/en.ts` + `locales/pt.ts` split the common pair across files.
    const perFile = new Map<string, Dictionary[]>()
    for (const file of files) {
      const dicts = dictionariesIn(file)
      if (dicts.length > 0) perFile.set(relative(file), dicts)
    }

    const groups = new Map<string, Map<Locale, Dictionary>>()
    const place = (key: string, locale: Locale, dict: Dictionary): void => {
      const slot = groups.get(key) ?? new Map<Locale, Dictionary>()
      if (slot.has(locale)) {
        throw new Error(`two ${locale} dictionaries claim pair ${key}: ${slot.get(locale)?.file} and ${dict.file}`)
      }
      slot.set(locale, dict)
      groups.set(key, slot)
    }

    for (const [rel, dicts] of perFile) {
      for (const dict of dicts) {
        const parsed = localeOf(dict.name)
        if (parsed === undefined) continue
        const sameFileCounterpart = dicts.some((other) => {
          const otherParsed = localeOf(other.name)
          return otherParsed !== undefined
            && otherParsed.pair === parsed.pair
            && otherParsed.locale !== parsed.locale
        })
        // Same-file pairs key by file so two pairs in one directory stay
        // distinct; split pairs key by directory so siblings meet.
        const key = sameFileCounterpart ? `${rel}::${parsed.pair}` : `${dirname(rel)}::${parsed.pair}`
        place(key, parsed.locale, dict)
      }
    }

    const problems: string[] = []
    const englishOnly = new Set<string>()
    let comparedPairs = 0
    for (const [key, slot] of [...groups].sort()) {
      const en = slot.get('en')
      const pt = slot.get('pt')
      if (en === undefined) {
        problems.push(`${pt?.file} declares ${pt?.name} with no English counterpart for pair ${key}`)
        continue
      }
      if (pt === undefined) {
        const id = `${en.file}::${en.name}`
        englishOnly.add(id)
        if (!ENGLISH_ONLY.has(id)) problems.push(`${id} has no pt counterpart; translate it or list it in ENGLISH_ONLY`)
        continue
      }
      comparedPairs++
      const enOnly = en.keys.filter(k => !pt.keys.includes(k))
      const ptOnly = pt.keys.filter(k => !en.keys.includes(k))
      if (enOnly.length > 0) problems.push(`${pt.file} ${pt.name} lacks keys of ${en.name}: ${enOnly.join(', ')}`)
      if (ptOnly.length > 0) problems.push(`${pt.file} ${pt.name} has keys absent from ${en.name}: ${ptOnly.join(', ')}`)
    }
    for (const id of ENGLISH_ONLY) {
      if (!englishOnly.has(id)) problems.push(`ENGLISH_ONLY lists ${id}, which is not an English-only dictionary`)
    }

    // The translated set only grows; a collapse means discovery or pairing
    // broke, which would hide a real asymmetry.
    expect(comparedPairs).toBeGreaterThanOrEqual(8)
    expect(problems).toEqual([])
  })
})
