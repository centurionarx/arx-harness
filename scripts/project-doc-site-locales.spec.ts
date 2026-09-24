/** Tests for the documentation site's published locale configuration. */

import { describe, expect, it, vi } from 'vitest'

// Importing configuration normally projects files. These assertions inspect
// the real locale values without writing the shared generated tree.
vi.mock('./project-doc-site.ts', async importOriginal => ({
  ...await importOriginal<typeof import('./project-doc-site.ts')>(),
  projectDocs: vi.fn(),
}))

const { default: config } = await import('../website/.vitepress/config.ts')

describe('documentation site locales', () => {
  it('publishes Portuguese root chrome and an independent English locale', () => {
    expect(config).toMatchObject({
      locales: {
        root: {
          label: 'Português (Brasil)',
          lang: 'pt-BR',
          themeConfig: {
            outline: { label: 'Nesta página' },
            docFooter: { prev: 'Anterior', next: 'Próxima' },
            skipToContentLabel: 'Ir para o conteúdo',
            langMenuLabel: 'Alterar idioma',
          },
        },
        en: { label: 'English', lang: 'en-US', link: '/en/' },
      },
      themeConfig: {
        search: {
          options: {
            locales: { root: { translations: { button: { buttonText: 'Pesquisar na documentação' } } } },
          },
        },
        editLink: { text: 'Editar esta página no GitHub' },
      },
    })
    expect(config).toHaveProperty('locales.root.themeConfig.nav', expect.arrayContaining([{
      text: 'Primeiros passos', link: '/guide/quickstart', activeMatch: '^/guide/',
    }]))
    expect(JSON.stringify(config)).not.toMatch(/\p{Script=Han}/u)
  })
})
