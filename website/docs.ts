/**
 * Canonical publication manifest for the documentation website.
 *
 * Markdown stays in its owning repository tier. This manifest maps each
 * canonical source into matching route trees for both site locales; when a
 * translation is absent, both routes intentionally project the available
 * source instead of copying Markdown.
 */

import { readFileSync } from 'node:fs'
import { parseTranslationPairingManifest, translationPairSourcePredicate } from '../scripts/translation-pairing.ts'

/** Locale key used by the VitePress site. */
export type DocsLocale = 'root' | 'en'

/** Sidebar collection rendered for one locale and top-level module. */
export type DocsSidebar =
  | 'pt-br-guide'
  | 'pt-br-develop'
  | 'pt-br-reference'
  | 'en-guide'
  | 'en-develop'
  | 'en-reference'

/** A page projected into the VitePress source tree. */
export interface DocsPage {
  /** VitePress locale whose route tree owns this projection. */
  locale: DocsLocale
  /** Language of the canonical source currently projected at this route. */
  contentLocale: 'pt-BR' | 'en-US'
  /** Repository-relative canonical Markdown source. */
  source: string
  /** VitePress route, including the `.md` suffix. */
  route: string
  /** Navigation label shown in the sidebar. */
  label: string
  /** Sidebar collection that owns the page, or null for a locale home page. */
  sidebar: DocsSidebar | null
  /** Section label within the sidebar. */
  section: string
  /** Stable order within the section. */
  order: number
  /** Heading levels included in this page's VitePress outline. */
  outline?: number | readonly [number, number] | 'deep' | false
  /** Additional repository paths that resolve to this page. */
  sourceAliases?: string[]
}

interface MirroredPage {
  source: string | Record<DocsLocale, string>
  route: string
  contentLocale: DocsPage['contentLocale'] | Record<DocsLocale, DocsPage['contentLocale']>
  label: Record<DocsLocale, string>
  sidebar: Record<DocsLocale, DocsSidebar | null>
  section: Record<DocsLocale, string>
  order: number
  outline?: DocsPage['outline']
  sourceAliases?: string[] | Partial<Record<DocsLocale, string[]>>
}

type PairedPage = Omit<MirroredPage, 'source' | 'contentLocale' | 'sourceAliases'> & {
  /** English side of a sibling `foo.md` / `foo.pt-BR.md` pair. */
  source: string
  /** Language-neutral repository aliases, such as the directory of an index page. */
  sourceAliases?: string[]
}

function localized<T>(value: T | Record<DocsLocale, T>, locale: DocsLocale): T {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<DocsLocale, T>)[locale]
    : value
}

function mirroredPages(pages: MirroredPage[]): DocsPage[] {
  return pages.flatMap(page => (['root', 'en'] as const).map((locale) => {
    const aliases = page.sourceAliases === undefined
      ? undefined
      : Array.isArray(page.sourceAliases) ? page.sourceAliases : page.sourceAliases[locale]
    return {
      locale,
      contentLocale: localized(page.contentLocale, locale),
      source: localized(page.source, locale),
      route: locale === 'root' ? page.route : `en/${page.route}`,
      label: page.label[locale],
      sidebar: page.sidebar[locale],
      section: page.section[locale],
      order: page.order,
      ...(page.outline === undefined ? {} : { outline: page.outline }),
      ...(aliases === undefined ? {} : { sourceAliases: aliases }),
    }
  }))
}

/** Whether an English source belongs to the active bilingual corpus the pairing manifest names. */
const isActivePairSource = translationPairSourcePredicate(parseTranslationPairingManifest(
  readFileSync(new URL('../scripts/translation-pairing.manifest.json', import.meta.url), 'utf8'),
))

/**
 * Both locale routes for a sibling pair. Inside the active corpus the root
 * locale projects the Portuguese side; outside it the counterpart is not yet
 * owed, so the root route projects the English source and says so through
 * `contentLocale`. The Portuguese path stays an alias either way, so a link
 * to it resolves to the same route once the translation lands.
 */
function pairedPages(pages: PairedPage[]): DocsPage[] {
  return mirroredPages(pages.map((page) => {
    const portugueseSource = page.source.replace(/\.md$/, '.pt-BR.md')
    const active = isActivePairSource(page.source)
    const sharedAliases = page.sourceAliases ?? []
    return {
      ...page,
      source: { root: active ? portugueseSource : page.source, en: page.source },
      contentLocale: { root: active ? 'pt-BR' : 'en-US', en: 'en-US' },
      sourceAliases: {
        root: [...sharedAliases, active ? page.source : portugueseSource],
        en: [...sharedAliases, portugueseSource],
      },
    }
  }))
}

const homeAndGuide = pairedPages([
  {
    source: 'docs/user/index.md',
    route: 'index.md',
    label: { root: 'arx Harness', en: 'arx Harness' },
    sidebar: { root: null, en: null },
    section: { root: 'Início', en: 'Home' },
    order: 0,
  },
  {
    source: 'docs/user/guide/index.md',
    route: 'guide/quickstart.md',
    label: { root: 'Usar a Web UI', en: 'Use the Web UI' },
    sidebar: { root: 'pt-br-guide', en: 'en-guide' },
    section: { root: 'Primeiros passos', en: 'Guide' },
    order: 1,
    sourceAliases: ['docs/user/guide'],
  },
  {
    source: 'docs/user/guide/providers.md',
    route: 'guide/providers.md',
    label: { root: 'Configurar modelos', en: 'Configure models' },
    sidebar: { root: 'pt-br-guide', en: 'en-guide' },
    section: { root: 'Primeiros passos', en: 'Guide' },
    order: 2,
  },
  {
    source: 'docs/user/guide/platforms.md',
    route: 'guide/platforms.md',
    label: { root: 'Suporte a plataformas', en: 'Platform support' },
    sidebar: { root: 'pt-br-guide', en: 'en-guide' },
    section: { root: 'Primeiros passos', en: 'Guide' },
    order: 3,
  },
  {
    source: 'docs/user/guide/security.md',
    route: 'guide/security.md',
    label: { root: 'Acesso e segurança', en: 'Access and security' },
    sidebar: { root: 'pt-br-guide', en: 'en-guide' },
    section: { root: 'Primeiros passos', en: 'Guide' },
    order: 4,
  },
  {
    source: 'docs/user/guide/python-sdk.md',
    route: 'guide/python-sdk.md',
    label: { root: 'Python', en: 'Python' },
    sidebar: { root: 'pt-br-guide', en: 'en-guide' },
    section: { root: 'SDK', en: 'SDK' },
    order: 1,
  },
])

const develop = pairedPages([
  {
    source: 'docs/user/develop/basic/index.md',
    route: 'develop/basic/index.md',
    label: { root: 'Seu primeiro plugin do Harness', en: 'Your first Harness plugin' },
    sidebar: { root: 'pt-br-develop', en: 'en-develop' },
    section: { root: 'Fundamentos', en: 'Basics' },
    order: 1,
    sourceAliases: ['docs/user/develop/basic'],
  },
  {
    source: 'docs/user/develop/basic/tool.md',
    route: 'develop/basic/tool.md',
    label: { root: 'Criar uma ferramenta', en: 'Build a tool' },
    sidebar: { root: 'pt-br-develop', en: 'en-develop' },
    section: { root: 'Fundamentos', en: 'Basics' },
    order: 2,
  },
  {
    source: 'docs/user/develop/basic/config.md',
    route: 'develop/basic/config.md',
    label: { root: 'Configuração de plugins', en: 'Plugin configuration' },
    sidebar: { root: 'pt-br-develop', en: 'en-develop' },
    section: { root: 'Fundamentos', en: 'Basics' },
    order: 3,
  },
  {
    source: 'docs/user/develop/basic/publish.md',
    route: 'develop/basic/publish.md',
    label: { root: 'Empacotar e instalar', en: 'Package and install' },
    sidebar: { root: 'pt-br-develop', en: 'en-develop' },
    section: { root: 'Fundamentos', en: 'Basics' },
    order: 4,
  },
  {
    source: 'docs/user/develop/framework/index.md',
    route: 'develop/framework/index.md',
    label: { root: 'Ciclo de vida de plugins', en: 'Plugin lifecycle' },
    sidebar: { root: 'pt-br-develop', en: 'en-develop' },
    section: { root: 'Framework', en: 'Framework' },
    order: 1,
    sourceAliases: ['docs/user/develop/framework'],
  },
  {
    source: 'docs/user/develop/framework/service.md',
    route: 'develop/framework/service.md',
    label: { root: 'Serviços e dependências', en: 'Services and dependencies' },
    sidebar: { root: 'pt-br-develop', en: 'en-develop' },
    section: { root: 'Framework', en: 'Framework' },
    order: 2,
  },
  {
    source: 'docs/user/develop/framework/events.md',
    route: 'develop/framework/events.md',
    label: { root: 'Sistema de eventos', en: 'Event system' },
    sidebar: { root: 'pt-br-develop', en: 'en-develop' },
    section: { root: 'Framework', en: 'Framework' },
    order: 3,
  },
  {
    source: 'docs/user/develop/practice/index.md',
    route: 'develop/practice/index.md',
    label: { root: 'Camadas de capacidade', en: 'Capability layering' },
    sidebar: { root: 'pt-br-develop', en: 'en-develop' },
    section: { root: 'Prática', en: 'Practice' },
    order: 1,
    sourceAliases: ['docs/user/develop/practice'],
  },
  {
    source: 'docs/user/develop/practice/llm-adapter.md',
    route: 'develop/practice/llm-adapter.md',
    label: { root: 'Adaptador de LLM', en: 'LLM adapter' },
    sidebar: { root: 'pt-br-develop', en: 'en-develop' },
    section: { root: 'Prática', en: 'Practice' },
    order: 2,
  },
])

const cordisTutorial = pairedPages(([
  ['index.md', 'Visão geral', 'Overview'],
  ['01-first-plugin.md', '1. Seu primeiro plugin', '1. Your first plugin'],
  ['02-lifecycle-and-effects.md', '2. Ciclo de vida e efeitos', '2. Lifecycle and effects'],
  ['03-services.md', '3. Serviços', '3. Services'],
  ['04-events.md', '4. Eventos', '4. Events'],
  ['05-config.md', '5. Configuração', '5. Configuration'],
  ['06-composition-and-hmr.md', '6. Composição e HMR', '6. Composition and HMR'],
  ['07-into-the-harness.md', '7. Integração com o Harness', '7. Into the harness'],
] as const).map(([file, rootLabel, enLabel], order): PairedPage => ({
  source: `docs/cordis-tutorial/${file}`,
  route: `develop/cordis-tutorial/${file}`,
  label: { root: rootLabel, en: enLabel },
  sidebar: { root: 'pt-br-develop', en: 'en-develop' },
  section: { root: 'Tutorial do framework Cordis', en: 'Cordis framework tutorial' },
  order,
  ...(file === 'index.md' ? { sourceAliases: ['docs/cordis-tutorial'] } : {}),
})))

const cordisPrimerReference = pairedPages([
  {
    source: 'docs/cordis-primer.md',
    route: 'reference/cordis-primer.md',
    label: { root: 'Introdução ao Cordis', en: 'Cordis primer' },
    sidebar: { root: 'pt-br-reference', en: 'en-reference' },
    section: { root: 'Conceitos', en: 'Concepts' },
    order: 1,
  },
])

/**
 * Subsystem pages grouped by the concern they document, as `[Portuguese section,
 * English section, pages]`. One flat list of every subsystem pushed the rest of
 * the reference sidebar below the fold.
 */
const subsystemGroups = [
  ['Visão geral', 'Overview', [
    ['README.md', 'Subsistemas', 'Subsystems'],
  ]],
  ['Núcleo e escopos', 'Core and scopes', [
    ['core.md', 'Núcleo', 'Core'],
    ['scope.md', 'Escopos', 'Scopes'],
    ['invariants.md', 'Invariantes de runtime', 'Runtime invariants'],
  ]],
  ['Sessões e persistência', 'Sessions and persistence', [
    ['session.md', 'Sessões', 'Sessions'],
    ['session-query.md', 'Consulta de sessões', 'Session query'],
    ['session-reference.md', 'Referências de sessão', 'Session references'],
    ['session-title.md', 'Títulos de sessão', 'Session titles'],
    ['session-projection.md', 'Projeções de sessão', 'Session projections'],
    ['persistence.md', 'Persistência de sessões', 'Session persistence'],
    ['spill.md', 'Armazenamento de spill', 'Spill storage'],
    ['session-telemetry.md', 'Telemetria', 'SessionTelemetryBackend'],
  ]],
  ['Modelo e contexto', 'Model and context', [
    ['llm-streaming.md', 'Streaming de LLM', 'LLM streaming'],
    ['token-meter.md', 'Medição de tokens', 'Token metering'],
    ['system-prompt.md', 'Prompts de sistema', 'System prompts'],
    ['compaction.md', 'Compactação de contexto', 'Compaction'],
  ]],
  ['Execução e ferramentas', 'Execution and tools', [
    ['tools.md', 'Ferramentas', 'Tools'],
    ['shell.md', 'Execução de Bash', 'Bash execution'],
    ['subprocess.md', 'Subprocessos', 'Subprocesses'],
    ['terminal.md', 'Sessões PTY', 'PTY sessions'],
    ['jobs.md', 'Tarefas em segundo plano', 'Background jobs'],
    ['filesystem.md', 'Sistema de arquivos', 'Filesystem'],
    ['lsp.md', 'Navegação LSP', 'LSP navigation'],
    ['code-runtime.md', 'Runtime de código', 'Code runtime'],
    ['web.md', 'Acesso à Web', 'Web access'],
    ['skills.md', 'Skills', 'Skills'],
    ['workflow.md', 'Workflows', 'Workflows'],
    ['subagent.md', 'Subagents', 'Subagents'],
  ]],
  ['Política e interação', 'Policy and interaction', [
    ['approval.md', 'Aprovações', 'Approvals'],
    ['permission-presets.md', 'Predefinições de permissão', 'Permission presets'],
    ['sandbox.md', 'Sandbox', 'Sandboxing'],
    ['plan.md', 'Modo de planejamento', 'Plan mode'],
    ['user-questions.md', 'Interação com o usuário', 'User interaction'],
    ['commands.md', 'Comandos do usuário', 'Human commands'],
    ['goal.md', 'Objetivos', 'Goals'],
    ['schedule.md', 'Lembretes agendados', 'Scheduled reminders'],
  ]],
  ['Plataforma e acesso', 'Platform and access', [
    ['web-server.md', 'Servidor HTTP', 'HTTP server'],
    ['typert.md', 'Typert', 'Typert'],
    ['client-modules.md', 'Módulos do cliente', 'Client modules'],
    ['storage.md', 'Armazenamento', 'Storage'],
    ['workspace.md', 'Workspaces', 'Workspaces'],
    ['settings.md', 'Configurações do usuário', 'User settings'],
    ['credentials.md', 'Credenciais do usuário', 'User credentials'],
  ]],
] as const

const subsystemsReference = subsystemGroups.flatMap(([rootSection, enSection, files]) => pairedPages(
  files.map(([file, rootLabel, enLabel], order): PairedPage => ({
    source: `docs/subsystems/${file}`,
    route: file === 'README.md' ? 'reference/subsystems/index.md' : `reference/subsystems/${file}`,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: 'pt-br-reference', en: 'en-reference' },
    section: { root: rootSection, en: enSection },
    order,
    // Subsystem pages carry long third-level sections a two-level outline reaches.
    outline: [2, 3],
    ...(file === 'README.md' ? { sourceAliases: ['docs/subsystems'] } : {}),
  })),
))

const reference = [
  ...pairedPages(([
    ['docs/architecture.md', 'reference/index.md', 'Arquitetura', 'Architecture', 0],
  ] as const).map(([source, route, rootLabel, enLabel, order]): PairedPage => ({
    source,
    route,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: 'pt-br-reference', en: 'en-reference' },
    section: { root: 'Conceitos', en: 'Concepts' },
    order,
  }))),
  ...pairedPages(([
    ['docs/capability-seams.md', 'reference/capability-seams.md', 'Serviços de capacidade', 'Capability services', 2],
    ['docs/agent-lifecycle.md', 'reference/agent-lifecycle.md', 'Ciclo de vida do agent', 'Agent lifecycle', 3],
    ['docs/tool-execution-pipeline.md', 'reference/tool-execution-pipeline.md', 'Execução de ferramentas', 'Tool execution', 4],
  ] as const).map(([source, route, rootLabel, enLabel, order]): PairedPage => ({
    source,
    route,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: 'pt-br-reference', en: 'en-reference' },
    section: { root: 'Conceitos', en: 'Concepts' },
    order,
  }))),
  ...pairedPages(([
    ['docs/config-catalog.md', 'reference/config-catalog.md', 'Configuração de plugins', 'Plugin configuration'],
    ['docs/tool-catalog.md', 'reference/tool-catalog.md', 'Schemas de ferramentas', 'Tool schemas'],
    ['docs/persistence-catalog.md', 'reference/persistence-catalog.md', 'Eventos de persistência', 'Persistence events', 'deep'],
  ] as const).map(([source, route, rootLabel, enLabel, outline], order): PairedPage => ({
    source,
    route,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: 'pt-br-reference', en: 'en-reference' },
    section: { root: 'Referência gerada', en: 'Generated reference' },
    order,
    ...(outline === undefined ? {} : { outline }),
  }))),
  ...pairedPages(([
    ['context.md', 'Context', 'Context'],
    ['events.md', 'Events', 'Events'],
    ['fiber.md', 'Fiber', 'Fiber'],
    ['registry.md', 'Plugin Registry', 'Plugin Registry'],
    ['service.md', 'Service', 'Service'],
  ] as const).map(([file, rootLabel, enLabel], order): PairedPage => ({
    source: `docs/cordis-api/${file}`,
    route: `reference/cordis-api/${file}`,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: 'pt-br-reference', en: 'en-reference' },
    section: { root: 'Cordis API', en: 'Cordis Core API' },
    order,
  }))),
  ...mirroredPages(([
    ['inherited.md', 'API herdada', 'Inherited surface'],
  ] as const).map(([file, rootLabel, enLabel], order): MirroredPage => ({
    source: `docs/cordis-api/${file}`,
    route: `reference/cordis-api/${file}`,
    contentLocale: 'en-US',
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: 'pt-br-reference', en: 'en-reference' },
    section: { root: 'Cordis API', en: 'Cordis Core API' },
    order: order + 5,
  }))),
  ...pairedPages(([
    ['adding-a-package.md', 'Adicionar um pacote', 'Adding a package'],
    ['adding-a-tool.md', 'Adicionar uma ferramenta', 'Adding a tool'],
    ['adding-an-llm-adapter.md', 'Adicionar um adaptador de LLM', 'Adding an LLM adapter'],
    ['adding-a-settings-card.md', 'Adicionar um cartão de configuração', 'Adding a settings card'],
    ['extension-cookbook.md', 'Padrões de extensão', 'Extension patterns'],
  ] as const).map(([file, rootLabel, enLabel], order): PairedPage => ({
    source: `docs/cookbook/${file}`,
    route: `reference/cookbook/${file}`,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: 'pt-br-reference', en: 'en-reference' },
    section: { root: 'Manual prático', en: 'Cookbook' },
    order,
  }))),
  ...pairedPages([{
    source: 'docs/cookbook/adding-a-conversation-node.md',
    route: 'reference/cookbook/adding-a-conversation-node.md',
    label: { root: 'Adicionar um Conversation Node', en: 'Adding a Conversation Node' },
    sidebar: { root: 'pt-br-reference', en: 'en-reference' },
    section: { root: 'Manual prático', en: 'Cookbook' },
    order: 5,
  }]),
]

/**
 * Sidebar collections of each locale, in the order the site's navigation
 * presents them. The navigation bar and the llms.txt index both read this
 * sequence, so a new collection lands in both surfaces together.
 */
export const localeCollections = {
  root: ['pt-br-guide', 'pt-br-develop', 'pt-br-reference'],
  en: ['en-guide', 'en-develop', 'en-reference'],
} as const satisfies Record<DocsLocale, readonly DocsSidebar[]>

/** A sidebar group, matched to pages by `label`. */
export interface DocsSection {
  /** Group heading, equal to the `section` field of every page it holds. */
  label: string
  /** Render the group collapsed until it holds the page being read. */
  collapsed?: boolean
}

/**
 * Every sidebar group, in the order its locale renders it.
 *
 * The subsystem groups collapse because together they outnumber the rest of the
 * reference sidebar; expanded, they push every other group below the fold.
 */
const sections: Record<DocsLocale, readonly DocsSection[]> = {
  root: [
    { label: 'Primeiros passos' }, { label: 'SDK' },
    { label: 'Fundamentos' }, { label: 'Framework' }, { label: 'Prática' }, { label: 'Tutorial do framework Cordis' },
    { label: 'Conceitos' }, { label: 'Referência gerada' }, { label: 'Cordis API' }, { label: 'Manual prático' },
    { label: 'Visão geral' },
    { label: 'Núcleo e escopos', collapsed: true },
    { label: 'Sessões e persistência', collapsed: true },
    { label: 'Modelo e contexto', collapsed: true },
    { label: 'Execução e ferramentas', collapsed: true },
    { label: 'Política e interação', collapsed: true },
    { label: 'Plataforma e acesso', collapsed: true },
  ],
  en: [
    { label: 'Guide' }, { label: 'SDK' },
    { label: 'Basics' }, { label: 'Framework' }, { label: 'Practice' }, { label: 'Cordis framework tutorial' },
    { label: 'Concepts' }, { label: 'Generated reference' }, { label: 'Cordis Core API' }, { label: 'Cookbook' },
    { label: 'Overview' },
    { label: 'Core and scopes', collapsed: true },
    { label: 'Sessions and persistence', collapsed: true },
    { label: 'Model and context', collapsed: true },
    { label: 'Execution and tools', collapsed: true },
    { label: 'Policy and interaction', collapsed: true },
    { label: 'Platform and access', collapsed: true },
  ],
}

/**
 * Placement and collapse behavior of one sidebar group.
 *
 * @param locale - Route tree whose sidebar is being built.
 * @param label - Section label carried by the pages in the group.
 * @returns The declared group, plus its zero-based position in the locale.
 * @throws When the locale declares no placement for the label. Ranking by list
 *   membership alone would sort an undeclared group silently ahead of every
 *   declared one.
 */
export function sectionSpec(locale: DocsLocale, label: string): DocsSection & { index: number } {
  const declared = sections[locale]
  const section = declared.find(candidate => candidate.label === label)
  if (section === undefined) throw new Error(`Sidebar section "${label}" has no placement in the ${locale} locale.`)
  return { ...section, index: declared.indexOf(section) }
}

/** Every canonical page published by the documentation website. */
export const docsPages: DocsPage[] = [
  ...homeAndGuide,
  ...develop,
  ...cordisTutorial,
  ...cordisPrimerReference,
  ...subsystemsReference,
  ...reference,
]

/**
 * Pages of one sidebar collection, in the order the sidebar lists them.
 *
 * @param locale - Route tree whose sidebar is being built.
 * @param collection - Sidebar collection to read.
 * @returns The collection's pages, ordered by section placement then by `order`.
 */
export function orderedPages(locale: DocsLocale, collection: DocsSidebar): DocsPage[] {
  return docsPages
    .filter(page => page.locale === locale && page.sidebar === collection)
    .sort((left, right) => (
      sectionSpec(locale, left.section).index - sectionSpec(locale, right.section).index
      || left.order - right.order
    ))
}

/**
 * Site-relative link for a published route.
 *
 * @param route - Manifest route, including its `.md` suffix.
 * @returns The link VitePress serves the route at.
 */
export function routeLink(route: string): string {
  return `/${route.replace(/(?:index)?\.md$/, '')}`
}

/**
 * Where a top-level navigation item lands.
 *
 * The target is derived rather than written down: a collection whose first page
 * is renamed or reordered would otherwise leave the navigation bar pointing at
 * a route the manifest no longer publishes.
 *
 * @param locale - Route tree the navigation item belongs to.
 * @param collection - Sidebar collection the item opens.
 * @returns Site-relative link of the collection's first page.
 * @throws When the collection publishes no page.
 */
export function landingLink(locale: DocsLocale, collection: DocsSidebar): string {
  const first = orderedPages(locale, collection)[0]
  if (first === undefined) throw new Error(`Sidebar collection "${collection}" publishes no page.`)
  return routeLink(first.route)
}
