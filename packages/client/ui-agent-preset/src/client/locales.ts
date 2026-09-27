/** Locale bundles for the agent-preset settings row, hero chip, header switch, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'headerHint' | 'headerNewSession'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetCodeName' | 'presetCodeDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Applies to sessions you start from now on. Running sessions keep the preset they began with.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Agent preset for the session you are about to start',
  headerHint: 'The agent preset this session runs, fixed when it started',
  headerNewSession: 'Starts a new session in this mode',
  nav: 'Agent presets',
  sectionIntro:
    'A preset is the plugin composition one session\'s agent runs — its tools, prompt, and capabilities. '
    + 'Duplicate an existing one and make it yours, or let the agent draft one for you in Creator mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
  presetCodeName: 'PTC mode',
  presetCodeDescription:
    'All Standard mode capabilities, with tools exposed through the Code Mode SDK so the model can combine multi-step operations in one TypeScript program.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'Two-tool coding agent with persistent bash and str_replace_editor.',
  presetCordisName: 'Creator mode',
  presetCordisDescription:
    'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
  duplicate: 'Duplicate',
  duplicateUnavailable: 'This deployment has no writable preset directory',
  delete: 'Delete',
  presetId: 'Identifier',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Name',
  displayNamePlaceholder: 'Shown in the picker; defaults to the identifier',
  inUse: 'In use',
  builtInGroup: 'Built-in',
  customGroup: 'Custom',
  noDescription: 'No description.',
  brokenBadge: 'Failed to load',
  brokenNoCopy: 'A preset that failed to load cannot be duplicated',
  copyOf: 'Copied from',
  composition: 'Composition (agent.cordis.yml)',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  copyTitle: 'Duplicate preset',
  copyIntro:
    'The whole preset is copied on this machine. The identifier becomes its directory name and cannot '
    + 'be changed later; everything else is edited in the preset\'s own files.',
  create: 'Create',
  creating: 'Creating…',
  creatorDraft: 'Draft a custom preset with Creator mode',
  openLocation: 'Open folder',
  showLocation: 'Show location',
  revealedPathLabel: 'Preset files:',
  idRequired: 'Give the preset an identifier.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'A preset with this identifier already exists.',
  deleteTitle: 'Delete this preset?',
  deleteDescription:
    'The preset directory is deleted. Sessions already running on it keep working; new sessions cannot select it.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',
}
/** Brazilian Portuguese copy. */
export const pt: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Vale para as sessões que você iniciar a partir de agora. As sessões em andamento mantêm o preset com que começaram.',
  loading: 'Carregando presets…',
  error: 'Não foi possível carregar os agent presets.',
  userTrust: 'Personalizado',
  seatHint: 'Agent preset da sessão que você vai iniciar',
  headerHint: 'O agent preset desta sessão, fixado quando ela começou',
  headerNewSession: 'Inicia uma nova sessão neste modo',
  nav: 'Agent presets',
  sectionIntro:
    'Um preset é a composição de plugins que o agent de uma sessão executa: as ferramentas, o prompt e as capacidades dele. '
    + 'Duplique um preset existente e adapte-o, ou peça ao agent que crie um rascunho para você no Modo criador.',
  builtIn: 'Integrado',
  setDefault: 'Definir como padrão',
  view: 'Ver',
  presetStandardName: 'Modo padrão',
  presetStandardDescription:
    'Coding agent completo, com edição de arquivos, shell, busca em arquivos e na web, skills, planejamento, metas, subagents e workflows.',
  presetCodeName: 'Modo PTC',
  presetCodeDescription:
    'Todas as capacidades do Modo padrão, com as ferramentas expostas pelo SDK do Code Mode para que o modelo combine operações de várias etapas em um único programa TypeScript.',
  presetMinimalName: 'Modo mínimo',
  presetMinimalDescription:
    'Coding agent com duas ferramentas: bash persistente e str_replace_editor.',
  presetCordisName: 'Modo criador',
  presetCordisDescription:
    'Feito para criar agent presets personalizados, com todas as capacidades do Modo padrão, além de inspeção do runtime, experimentos com plugins e orientação para criar presets.',
  duplicate: 'Duplicar',
  duplicateUnavailable: 'Este deploy não tem um diretório de presets gravável',
  delete: 'Excluir',
  presetId: 'Identificador',
  presetIdPlaceholder: 'meu-agent',
  displayName: 'Nome',
  displayNamePlaceholder: 'Exibido no seletor; sem nome, aparece o identificador',
  inUse: 'Em uso',
  builtInGroup: 'Integrados',
  customGroup: 'Personalizados',
  noDescription: 'Sem descrição.',
  brokenBadge: 'Falha ao carregar',
  brokenNoCopy: 'Um preset que falhou ao carregar não pode ser duplicado',
  copyOf: 'Copiado de',
  composition: 'Composição (agent.cordis.yml)',
  cancel: 'Cancelar',
  close: 'Fechar',
  retry: 'Tentar novamente',
  copyTitle: 'Duplicar preset',
  copyIntro:
    'O preset inteiro é copiado nesta máquina. O identificador vira o nome do diretório e não pode ser alterado '
    + 'depois; todo o resto é editado nos próprios arquivos do preset.',
  create: 'Criar',
  creating: 'Criando…',
  creatorDraft: 'Criar o rascunho de um preset personalizado com o Modo criador',
  openLocation: 'Abrir pasta',
  showLocation: 'Mostrar local',
  revealedPathLabel: 'Arquivos do preset:',
  idRequired: 'Dê um identificador ao preset.',
  idInvalid: 'Use letras minúsculas, dígitos e hifens, começando por uma letra ou um dígito.',
  idTaken: 'Já existe um preset com este identificador.',
  deleteTitle: 'Excluir este preset?',
  deleteDescription:
    'O diretório do preset é excluído. As sessões que já estão rodando com ele continuam funcionando; novas sessões não podem selecioná-lo.',
  deleteConfirm: 'Excluir',
  deleting: 'Excluindo…',
}
/** Preset roster fields needed to resolve Web display copy. */
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active Web locale. */
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  code: { name: 'presetCodeName', description: 'presetCodeDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active Web locale lookup.
 * @returns localized copy for a known shipped preset, otherwise file metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}
