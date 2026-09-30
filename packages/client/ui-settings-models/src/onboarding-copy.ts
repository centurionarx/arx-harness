/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'

/** The complete editable internal-testing notice in each supported GUI locale. */
export const WELCOME_NOTICE_COPY = {
  en: {
    title: 'Internal Testing Notice',
    body: "arx Harness 0.1 remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. arx Harness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\n\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the ARX plugin ecosystem.",
    continueLabel: 'Continue',
  },
  pt: {
    title: 'Aviso de teste interno',
    body: 'O arx Harness 0.1 continua em teste para desenvolvedores de Harness. Muitas áreas ainda precisam melhorar, e o feedback da comunidade de desenvolvedores é bem-vindo. Os plugins centrais e as APIs fundamentais do arx Harness vão continuar evoluindo rapidamente nos próximos meses.\n\nQueremos explorar os limites da inteligência com desenvolvedores do mundo todo, sobre uma infraestrutura aberta, de código aberto, reutilizável e componível. Desenvolvedores de Harness de qualquer lugar são bem-vindos ao ecossistema de plugins ARX.',
    continueLabel: 'Continuar',
  },
} as const

/** Field storing the last home-migration notice the user acknowledged. */
export const HOME_MIGRATION_ACK_FIELD = 'homeMigrationNoticedAt'

/**
 * The home-migration notice in each supported GUI locale.
 *
 * `{from}` and `{to}` are replaced with the symbolic home names the Host
 * reports, so the notice never prints an absolute path from the user's
 * machine.
 */
export const HOME_MIGRATION_NOTICE_COPY = {
  en: {
    title: 'Your settings were copied',
    body: 'This installation found configuration from an earlier version at {from} and copied it to {to}.'
      + '\n\nYour models, credentials, profiles, and past sessions came across. {from} was left exactly as it was;'
      + ' delete it once you are satisfied everything works.',
    continueLabel: 'Continue',
  },
  pt: {
    title: 'Suas configurações foram copiadas',
    body: 'Esta instalação encontrou a configuração de uma versão anterior em {from} e a copiou para {to}.'
      + '\n\nSeus modelos, credenciais, perfis e sessões anteriores vieram junto. {from} ficou exatamente como estava;'
      + ' apague-o quando tiver certeza de que tudo funciona.',
    continueLabel: 'Continuar',
  },
} as const

/** Field storing the last provider guide version the user dismissed. */
export const PROVIDER_GUIDE_ACK_FIELD = 'providerGuideVersion'

/**
 * Bump only when the guide changes materially and every user who still has
 * no usable provider should see it again. The acknowledgement is compared for
 * exact equality.
 */
export const PROVIDER_GUIDE_VERSION = '2026-09-23.1'

/**
 * The guide shown while no model provider is usable, in each supported GUI
 * locale. It names no provider itself: `{count}` and `{name}` are filled from
 * the provider directory, so it lists what this installation can add.
 */
export const PROVIDER_GUIDE_COPY = {
  en: {
    title: 'Set up a model provider',
    body: 'arx Harness does not come with a model provider, so it cannot start a task yet. Add one in Settings → Models.',
    offersLead: 'This installation can use:',
    hosted: '{count} hosted providers, reached with an API key or cloud credentials',
    hostedOne: 'One hosted provider, reached with an API key or cloud credentials',
    compatible: 'Any service with an OpenAI-compatible API',
    commandLine: '{name}, through its command-line tool signed in on this machine',
    open: 'Open Models settings',
    later: 'Later',
  },
  pt: {
    title: 'Configure um provedor de modelos',
    body: 'O arx Harness não vem com um provedor de modelos, então ainda não consegue iniciar uma tarefa. Adicione um em Configurações → Modelos.',
    offersLead: 'Esta instalação pode usar:',
    hosted: '{count} provedores hospedados, acessados com uma chave de API ou credenciais de nuvem',
    hostedOne: 'Um provedor hospedado, acessado com uma chave de API ou credenciais de nuvem',
    compatible: 'Qualquer serviço com uma API compatível com a da OpenAI',
    commandLine: '{name}, pela ferramenta de linha de comando conectada nesta máquina',
    open: 'Abrir as configurações de Modelos',
    later: 'Depois',
  },
} as const
