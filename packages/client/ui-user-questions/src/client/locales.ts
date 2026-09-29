/** `question` namespace dictionaries. */
/** The question namespace key union. */
export type QuestionKey = keyof typeof en

/** English dictionary. */
export const en = {
  'error.incomplete': 'Please complete this question first.',
  'error.unanswered': 'Please select an option or enter a custom answer.',
  'nav.prev': 'Previous question',
  'nav.next': 'Next question',
  'nav.minimize': 'Collapse the question card',
  'nav.maximize': 'Expand the question card',
  'nav.cancel': 'Dismiss all questions',
  'option.recommended': 'Recommended',
  'custom.placeholder': 'Type your answer',
  'action.skip': 'Skip this question',
  'action.next': 'Next',
  'plan.header': 'Plan review',
  'plan.approve': 'Approve',
  'plan.decline': 'Refuse',
  'plan.discuss': 'Chat about it',
} satisfies Record<string, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'error.incomplete': 'Responda esta pergunta primeiro.',
  'error.unanswered': 'Selecione uma opção ou digite uma resposta.',
  'nav.prev': 'Pergunta anterior',
  'nav.next': 'Próxima pergunta',
  'nav.minimize': 'Recolher o cartão de perguntas',
  'nav.maximize': 'Expandir o cartão de perguntas',
  'nav.cancel': 'Dispensar todas as perguntas',
  'option.recommended': 'Recomendado',
  'custom.placeholder': 'Digite sua resposta',
  'action.skip': 'Pular esta pergunta',
  'action.next': 'Próxima',
  'plan.header': 'Revisão do plano',
  'plan.approve': 'Aprovar',
  'plan.decline': 'Recusar',
  'plan.discuss': 'Conversar sobre o plano',
} satisfies Record<QuestionKey, string>
