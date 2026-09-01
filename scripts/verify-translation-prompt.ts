/** Verify that the committed translation prompt renders and parses as documented. */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  consumeTranslationResponse,
  documentedTranslationPromptPlaceholders,
  parseTranslationResponse,
  renderTranslationPrompt,
  renderTranslationRequest,
  renderTranslationResponse,
  TRANSLATION_PROMPT_PLACEHOLDERS,
  type TranslationExample,
} from './translation-prompt.ts'

const root = resolve(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

try {
  const mode = process.argv[2]
  if (mode !== undefined && mode !== '--snapshot') throw new Error(`unsupported argument ${JSON.stringify(mode)}`)
  const document = read('docs/i18n/translation-prompt.md')
  const terminology = read('docs/i18n/terminology.md')
  const examplePaths = [
    ['README.md', 'README.pt-BR.md'],
    ['docs/development.md', 'docs/development.pt-BR.md'],
    ['docs/i18n/README.md', 'docs/i18n/README.pt-BR.md'],
    ['docs/i18n/translation-rules.md', 'docs/i18n/translation-rules.pt-BR.md'],
    [
      '.agents/notes/implemented/process/2026-07-02-bilingual-docs-and-pairing-gate.md',
      '.agents/notes/implemented/process/2026-07-02-bilingual-docs-and-pairing-gate.pt-BR.md',
    ],
  ] as const
  const examples: TranslationExample[] = examplePaths.map(([english, portuguese]) => ({
    english: read(english),
    portuguese: read(portuguese),
  }))
  const sourceDocument = read('scripts/fixtures/translation-prompt/snapshot-note.md')
  const recordedResponse = read('scripts/fixtures/translation-prompt/response.txt')
  const documented = documentedTranslationPromptPlaceholders(document)
  if (documented.join('\n') !== TRANSLATION_PROMPT_PLACEHOLDERS.join('\n')) {
    throw new Error(`placeholder table must list exactly: ${TRANSLATION_PROMPT_PLACEHOLDERS.join(', ')}`)
  }

  const englishInput = { sourceLanguage: 'English' as const, sourceFilename: 'snapshot-note.md', terminology }
  const englishSource = renderTranslationPrompt(document, englishInput)
  const portugueseSource = renderTranslationPrompt(document, {
    sourceLanguage: 'Portuguese',
    sourceFilename: 'snapshot-note.pt-BR.md',
    terminology,
  })
  if (englishSource.includes('{{') || portugueseSource.includes('{{')) throw new Error('rendered prompt contains an unresolved placeholder')
  if (!englishSource.includes('from English to Portuguese')) throw new Error('English-source render does not translate into Portuguese')
  if (!portugueseSource.includes('from Portuguese to English')) throw new Error('Portuguese-source render does not translate into English')

  const example = /```xml\n([\s\S]*?)\n```/.exec(englishSource)?.[1]
  if (example === undefined) throw new Error('rendered prompt has no three-section response example')
  parseTranslationResponse(example)

  const roundTrip = { translation: 'first pass\n\nwith **markdown**', review: '- No corrections', final: 'final text' }
  const parsed = parseTranslationResponse(renderTranslationResponse(roundTrip))
  if (JSON.stringify(parsed) !== JSON.stringify(roundTrip)) throw new Error('three-section response does not round-trip')

  const request = renderTranslationRequest(document, { ...englishInput, sourceDocument, examples })
  if (request.targetFilename !== 'snapshot-note.pt-BR.md') throw new Error('English request resolves the wrong target filename')
  const expectedRoles = ['system', ...examples.flatMap(() => ['user', 'assistant']), 'user']
  if (request.messages.map(message => message.role).join('\n') !== expectedRoles.join('\n')) {
    throw new Error('reviewed examples are not assembled as system, example pairs, then source')
  }
  const consumed = consumeTranslationResponse(recordedResponse, englishInput)
  const expectedFinalPrefix = [
    '---',
    'layout: doc',
    '---',
    '',
    '# Nota do snapshot',
    '',
    '[English](snapshot-note.md) | Português',
    '',
  ].join('\n')
  if (!consumed.final.startsWith(expectedFinalPrefix)) {
    throw new Error('recorded frontmatter response does not preserve metadata and receive the canonical target switcher')
  }

  if (mode === '--snapshot') {
    process.stdout.write(`${JSON.stringify({ request, response: consumed }, null, 2)}\n`)
  } else {
    console.log('verify-translation-prompt: both directions render, reviewed examples assemble, and the consumed response is target-path correct.')
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`verify-translation-prompt: ${message}`)
  process.exit(1)
}
