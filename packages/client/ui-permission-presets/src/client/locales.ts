/** `settings.permission` namespace dictionaries (the Permission row's copy). */
/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof en

/** English dictionary. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
  'preset.custom': 'Custom',
} satisfies Record<string, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'title': 'Permissão',
  'description': 'Escolha o modo de permissão padrão das novas sessões',
  'loading': 'Carregando',
  'unavailable': 'Indisponível',
  'confirm.title': 'Ativar o Acesso total?',
  'confirm.description': 'O Acesso total deixa as novas sessões reduzirem as etapas de confirmação e executarem mais ações diretamente, incluindo operações sensíveis, alterações de arquivos e comandos externos. Use-o só quando confiar nas próximas tarefas.',
  'confirm.acknowledge': 'Entendo os riscos e quero continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Ativar o Acesso total',
  'preset.readOnly': 'Somente leitura',
  'preset.workspaceWrite': 'Gravação no workspace',
  'preset.fullAccess': 'Acesso total',
  'preset.custom': 'Personalizado',
} satisfies Record<PermissionSettingsKey, string>

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
  'preset.custom': 'Custom',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessEn

/** Brazilian Portuguese dictionary for the current-session popup gate. */
export const accessPt = {
  'confirm.title': 'Ativar o Acesso total?',
  'confirm.description': 'O Acesso total reduz as etapas de confirmação e deixa o agent executar mais ações diretamente, incluindo operações sensíveis, alterações de arquivos e comandos externos. Use-o só quando confiar na tarefa atual.',
  'confirm.acknowledge': 'Entendo os riscos e quero continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Ativar o Acesso total',
  'preset.readOnly': 'Somente leitura',
  'preset.workspaceWrite': 'Gravação no workspace',
  'preset.fullAccess': 'Acesso total',
  'preset.custom': 'Personalizado',
} satisfies Record<PermissionAccessKey, string>
