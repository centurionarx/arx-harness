/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` reads identically to `trigger.fallback` today and is
 * still a separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */
/** The model namespace key union. */
export type ModelKey = keyof typeof en

/** English dictionary. */
export const en = {
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.aria': 'Model and reasoning effort',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'blocked.unselected': 'Select a model to start',
  'blocked.noProvider': 'Set up a model provider to start',
  'blocked.setUpProvider': 'Set up a model provider',
  'empty.efforts': 'This model provides no reasoning effort levels.',
  'effort.level.off': 'Off',
  'effort.level.minimal': 'Minimal',
  'effort.level.low': 'Low',
  'effort.level.medium': 'Medium',
  'effort.level.high': 'High',
  'effort.level.xhigh': 'Extra high',
  'effort.level.max': 'Max',
} satisfies Record<string, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'command.description': 'Selecionar o modelo desta conversa',
  'option.loadError': 'Falha ao carregar o catálogo: {message}',
  'trigger.fallback': 'Selecionar modelo',
  'trigger.selectAria': 'Selecionar modelo',
  'trigger.aria': 'Selecionar modelo, atual: {model}',
  'trigger.ariaEffort': 'Selecionar modelo, atual: {model}, esforço de raciocínio {effort}',
  'menu.aria': 'Modelo e esforço de raciocínio',
  'menu.model': 'Modelo',
  'menu.effort': 'Esforço',
  'effort.providerDefault': 'Padrão',
  'status.loading': 'Atualizando a lista de modelos…',
  'error.action': 'Falha na operação do modelo: {message}',
  'action.reload': 'Recarregar',
  'warning.groupLoad': 'Falha ao carregar {name}: {message}',
  'empty.models': 'Nenhum modelo disponível.',
  'blocked.composer': 'Este modelo não está disponível — selecione outro para continuar',
  'blocked.unselected': 'Selecione um modelo para começar',
  'blocked.noProvider': 'Configure um provedor de modelos para começar',
  'blocked.setUpProvider': 'Configurar um provedor de modelos',
  'empty.efforts': 'Este modelo não oferece níveis de esforço de raciocínio.',
  'effort.level.off': 'Desligado',
  'effort.level.minimal': 'Mínimo',
  'effort.level.low': 'Baixo',
  'effort.level.medium': 'Médio',
  'effort.level.high': 'Alto',
  'effort.level.xhigh': 'Extra',
  'effort.level.max': 'Máx',
} satisfies Record<ModelKey, string>
