# Guia de desenvolvimento

[English](development.md) | Português

O tutorial de configuração leva um contribuidor novo dos pré-requisitos a um checkout verificado. A referência de contribuidor a seguir cobre o layout do repositório, o fluxo de trabalho diário e a organização do CI. Racional de design e detalhes de implementação pertencem às notas de agente e aos scripts apontados.

## Tutorial de configuração

### Pré-requisitos

- Node.js suporta 22.19+ e 24+. O CI cobre 22.19, 24 e 26; veja a [nota de agente do piso de engine Node](../.agents/notes/implemented/process/2026-07-06-node-engine-floor.md).
- pnpm com Corepack habilitado. O repositório fixa o pnpm no `package.json`; execute `corepack enable` se `pnpm --version` não resolver via Corepack.
- Git 2.26 ou mais novo; a configuração de hooks habilita a extensão de configuração específica de worktree do Git.
- Opcional: uma API key de provedor (`DEEPSEEK_API_KEY`) para as demos Web, headless e de automação ACP e para os e2e de API real.

### Configuração inicial

Instale as dependências a partir da raiz do repositório:

```sh
pnpm install
```

A instalação também configura hooks Lefthook locais da worktree e o merge driver Git `arx-translation-pairing` via `scripts/install-lefthook.mjs`. A [nota de agente de hooks locais de worktree](../.agents/notes/implemented/process/2026-07-27-worktree-local-lefthook.md) controla o plano de segurança dos caminhos de hook; a [nota de agente de merges automáticos de pareamento](../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md) controla o merge driver.

Caso uma das integrações esteja ausente porque as dependências vieram de cache ou o `postinstall` foi pulado, instale-as manualmente:

```sh
node scripts/install-lefthook.mjs
```

Se o wrapper rejeitar configuração Git existente ou reportar lock obsoleto, siga o diagnóstico dele e a nota de agente apontada em vez de editar metadados da worktree por conta própria. Após mover um checkout, rode o wrapper novamente para regenerar o caminho controlado.

Rode o typecheck uma vez após um clone novo:

```sh
pnpm run typecheck
```

A configuração está completa quando `pnpm run typecheck` sai com sucesso.

## Referência de contribuidor

### Layout de projetos TypeScript

O repositório usa agregados Host e Client isolados. Um pacote comum é registrado em exatamente um agregado: pacotes Host em `tsconfig.host.json` e pacotes Client em `tsconfig.client.json`.

| Arquivo | Papel | Formar programa? |
|---|---|---|
| `tsconfig.json` | Raiz da solução: `extends` da base, `files: []` e references aos dois agregados. É o ponto de descoberta do tsserver e a entrada para rodar explicitamente o grafo completo de Project Reference; pelas `paths` herdadas, é também a config de resolução do tsx executando `examples/` e `scripts/`. | Não |
| `tsconfig.host.json` | Agregado Host: pacotes Host, examples, tests, scripts, website e o projeto Host excepcional de `api/remotes`. | Sim |
| `tsconfig.client.json` | Agregado Client: pacotes `packages/client/*` e seus tests, `apps/web` e o projeto Client excepcional de `api/remotes`. | Sim |
| `tsconfig.base.json` | Shared compilerOptions e o mapa fonte de `paths`. Também é a fachada de resolução sobre a qual as configs do vitest apontam o vite-tsconfig-paths: não tem `include`, então suas `paths` valem para todo importador. | Não |
| `tsconfig.base.client.json` | Configurações de compilador de navegador (`jsx`, libs DOM, `types: []`) estendidas pelo agregado Client e por todo pacote `packages/client/*`. | Não |

Host e Client permanecem dois programas agregados porque os dois lados fazem declaration-merge da interface `Context` do cordis sob as mesmas chaves com services diferentes; um programa que vê os dois merges reporta colisão. A colisão existe apenas dentro de um `ts.Program` — a resolução de módulos nunca a dispara — razão pela qual a solução pode referenciar os dois agregados e uma fachada de paths pode cobrir os dois lados. Seguem três disciplinas:

- `tsconfig.base.json` nunca ganha `include` ou `files`: eles vazariam para todo projeto de pacote que a estende e estreitariam o escopo match-all da fachada.
- Um script que constrói um `ts.Program` de repositório inteiro semeia `tsconfig.host.json` ou `tsconfig.client.json` explicitamente — nunca a solução raiz, porque achatar os dois agregados em um programa colide os merges de `Context`.
- Um pacote novo é registrado em exatamente um agregado. Ter um entry de loader Node e um de navegador não é razão para dividir um pacote; um plugin Client comum produz os dois artefatos de runtime durante a fase de build do Client.

`api/remotes` é o único pacote do repositório com tsconfigs Host e Client divididos. A entry Host dele precisa participar do grafo Typert do Host, enquanto a entry Client importa declarações `/remote` que o tsdown do Host precisa gerar primeiro. O `tsconfig.json` da raiz do pacote, portanto, é apenas uma solução, e os dois agregados e consumidores diretos referenciam `tsconfig.host.json` ou `tsconfig.client.json` respectivamente. A gate de `constraints` do workspace caminha pelo grafo alcançável de Project Reference e confere a própria face de compilador de cada projeto de referência: um alvo de config única continua válido a partir de qualquer face, enquanto um alvo dividido precisa nomear a folha correspondente em vez da raiz da solução ou da folha oposta; ele descobre pacotes divididos pela presença de ambos os configs de folha, então um pacote dividido novo entra na gate automaticamente. Não copie esta estrutura para outros pacotes; o [README de `api-remotes`](../packages/api/remotes/README.md) explica a divisão Host/Client e a ordem de build.

O build raiz segue a ordem de dependências geradas:

```sh
tsc -b tsconfig.host.json
tsdown --env.ARX_BUILD_FACE host
tsc -b tsconfig.client.json
tsdown --env.ARX_BUILD_FACE client
pnpm run build:web
```

Os scripts npm rodam as duas fases de tsc com heap de 4 GB (`node --max-old-space-size=4096`), porque um build Host a frio chega perto de 2,3 GB, acima do heap padrão do V8 em um runner de CI de 7 GB. Ambas as passadas do tsdown usam o mesmo match completo de workspace. Elas nem scanneiam artefatos de build para descobrir pacotes Client nem mantêm uma lista de filtro de pacotes Host/Client. Os configs de tsdown por pacote selecionam as entries da fase atual via `ARX_BUILD_FACE`: um plugin Client comum produz o loader Node e o bundle de navegador dele durante a fase Client; `api-remotes` usa `hostPhase: true` para produzir a entry Host dele cedo e apenas o bundle de navegador durante a fase Client. O tsdown consome apenas o JavaScript emitido em `lib/types` pela fase de tsc anterior.

O Typert roda só durante o tsdown do Host, semeado por `tsconfig.host.json`. Ele analisa os tipos do Host e gera tanto os artefatos de reflexão do Host quanto a projeção Remote Host-for-Client; o tsdown do Client não inicia o Typert. Consequentemente, `pnpm run typecheck` roda a fase lib completa do Host antes do tsc do Client, enquanto `pnpm run build` continua até o tsdown do Client e o build da Web. A [nota de build do contrato gerado de api-remotes](../.agents/notes/implemented/process/2026-08-08-api-remotes-generated-contract-build.md) registra essa decisão de ordenação.

`pnpm run build` embute o ambiente `ARX_CLIENT_*` exato de quem chamou e não usa valores públicos de client quando nenhum está definido. `pnpm run build:official` é o equivalente local multiplataforma do build de artefatos do CI e do release. Cada build completo bem-sucedido grava um registro gitignored que liga esses valores à saída do Vite e aos bundles de client dinâmicos; o empacotamento de release e os tests Web da build rejeitam um registro ausente ou artefatos alterados por um build parcial posterior.

A análise estática e os tests resolvem imports de workspace pelo mapa `paths` da base até `src` e precisam passar em uma árvore limpa; gates que consomem a saída de `lib/` construída declaram essa dependência explicitamente. As declarações Remote geradas Host-for-Client são a exceção deliberada: os comandos públicos `typecheck`, `lint` e `doc-typecheck` as geram primeiro, enquanto os scripts internos `*:contracts-ready` assumem que um comando público que invoca ou uma gate de scheduler já depende da passada de geração de contratos do Typert ou do build completo. Veja a [nota da raiz de solução](../.agents/notes/implemented/process/2026-07-22-tsconfig-solution-root-two-aggregates.md) para a configuração de dois agregados, a [nota ts-build-config](../.agents/notes/implemented/process/2026-06-17-ts-build-config.md) para a propriedade do emit tsc-first e a [nota Typert Remote](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md) para o contrato de preparação das gates.

Services de negócio declaram métodos chamáveis no Host com `@Remote` ou `@RemoteScope`; o build do Host gera tipos Host-for-Client e contribuições de runtime, e a composição `api-remotes` do Client carrega essas contribuições sob os namespaces `ctx.remote` e `agentCtx.remote` escopados. Veja [API Gateway](api-gateway.md) para os artefatos gerados nos dois lados, as relações de assembly deles, o fallback de desenvolvimento SRC e a ordem de build da Web.

Se uma verificação local relevante consome a saída construída de pacotes, faça o build uma vez primeiro:

```sh
pnpm run build
```

`pnpm run hygiene` inclui `publint`, que valida entrypoints de pacotes contra os arquivos `lib/*.js` construídos, e `verify-node-next-types`, que valida declarações construídas contra um consumidor NodeNext temporário. Uma worktree nova não tem JS empacotado nem declarações até `pnpm run build` rodar; commits e pushes comuns não exigem esse build, salvo se as verificações selecionadas o consumirem.

### Variáveis de ambiente

O adapter de provedor real e as demos de agente com API key leem credenciais do ambiente ou de um `.env` gitignored na raiz do repositório:

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://... # optional
```

`DEEPSEEK_BASE_URL` é opcional e assume a API pública como padrão. Nunca commite credenciais reais. Os suites e2e de API real se pulam sozinhos quando `DEEPSEEK_API_KEY` não está definida.

### Integrações Git

O merge driver de pareamento deriva um registro `.i18n.yaml` em conflito a partir do ancestral confirmado, dos blobs atuais e do outro dono quando os dois arquivos de idioma usam a estratégia textual padrão do Git e fazem merge limpo. Ele falha em modo fechado diante de conflitos de dono, configuração de merge não textual ou registros inválidos; após um merge já interrompido, rode `pnpm run resolve-translation-pairing-conflicts`, que faz o staging de cada registro de pareamento seguro e sai com erro se outros conflitos de pareamento precisarem de trabalho manual. Veja o [contrato de documentação bilíngue](i18n/README.pt-BR.md#the-pairing-contract) para os arquivos e estados exatos que o driver aceita.

O instalador sonda o entrypoint exato do driver Node/tsx antes de publicar a configuração da worktree dele. Se esse runtime ficar indisponível depois, o launcher independente de Node escreve o resultado textual comum do Git, deixa o sidecar não resolvido e imprime o caminho de recuperação; restaure as dependências e rode `pnpm run resolve-translation-pairing-conflicts`, ou rode `git merge --abort`. Se o `pre-merge-commit` rejeitar um merge de resto limpo, o Git deixa o resultado completo em staging sem commit; repare a falha e rode `git commit`, ou aborte. A [nota de agente de merges automáticos de pareamento](../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md#failure-contract) controla os estados exatos de index e `MERGE_HEAD`.

O lefthook é configurado em `lefthook.yml` como um checkpoint local rápido:

- `pre-commit` verifica os registros de pareamento em staging contra os blobs donos em staging, valida os arquivos em staging com o perfil sem projeto `.oxlintrc.staged.json` e aplica fixes do Oxlint com um retry limitado, regenera `THIRD_PARTY_NOTICES.md` quando um arquivo em staging é uma das entradas dele, confere o diff em staging por erros de whitespace e roda o guard do manifesto de vendor.
- `pre-merge-commit` realiza a mesma verificação de pareamento indexada antes do Git criar um merge commit automático.
- `pre-push` roda `pnpm run typecheck`, que completa a fase lib do Host, incluindo os contratos Typert gerados, antes da verificação TypeScript do Client.

O guard do manifesto de vendor confere que mudanças sob `vendor/*/src` entram em staging com a atualização correspondente do manifesto `vendor/README.md`. Veja `vendor/README.md` antes de editar código vendored.

Além da verificação escopada de registros em staging, os hooks deliberadamente não rodam tests, snapshots, checks de documentação, builds ou hygiene. Contribuidores rodam uma vez as [checks relevantes ao comportamento modificado](../AGENTS.md#run-relevant-checks-locally); o CI é dono da cobertura exaustiva, dos smokes de artefatos construídos e da matriz de compatibilidade Node 22.19, 24 e 26.

Contribuidores podem ativar a lista de gates locais completas com `pnpm run check:all`. O comando é independente dos hooks Git e não é uma instrução de agente.

### Gates de CI

O [workflow de CI](../.github/workflows/ci.yml) sem chaves agrupa gates independentes em lanes amplas e roda um sinal de compatibilidade menor nas versões Node suportadas. Consumidores de artefatos esperam um build dentro da própria lane. O workflow separado de API real roda `pnpm run test:e2e` com o worker configurado travado. Veja [scripts/run-gates.ts](../scripts/run-gates.ts) e os arquivos de workflow para o inventário atual de gates e jobs.

### Ciclo de versões

A família arx compartilha uma versão em cada manifesto, e o app em execução a imprime sob o wordmark da sidebar, então o número que um usuário lê nomeia a árvore que ele está olhando.

- **Patch** (`1.0.1` para `1.0.2`) para toda mudança ou fix lançado. `pnpm run release:arx patch` reescreve os manifests e committa; o lockfile acompanha.
- **Minor** (`1.0.x` para `1.1.0`) somente quando o dono do repositório pedir. Nenhum volume de trabalho acumulado promove um release a um novo minor sem esse pedido explícito.
- **Major** (`1.x` para `2.0.0`) apenas quando o dono do repositório pedir. Nenhuma soma de mudanças acumuladas promove sozinha um release a um major novo.

### Comandos diários

As [instruções de contribuidor](../AGENTS.md#commands) da raiz resumem os comandos comuns, enquanto [`package.json`](../package.json) e [scripts/run-gates.ts](../scripts/run-gates.ts) controlam os inventários atuais de scripts e gates. Selecione as menores verificações que cubram a superfície modificada. Mudanças de documentação usam `pnpm run doc-sync`; mudanças de comportamento público de pacote também atualizam o README ou o JSDoc responsável, e checks de artefato construído exigem `pnpm run build` primeiro.

### Demos

Rode o build do repositório separadamente antes de usar estas demos de checkout-fonte:

```sh
pnpm run build
```

O agente de codificação Headless de um tiro precisa de `DEEPSEEK_API_KEY` no ambiente ou no `.env` da raiz:

```sh
pnpm arx --profile headless "summarize this workspace"
```

A demo cordis autorreferente pode inspecionar e modificar o runtime de plugins vivo dela e precisa das mesmas credenciais (`web` por padrão, ou `acp`):

```sh
pnpm run demo:cordis
```

O servidor de automação ACP expõe sessões de agente frescas por JSON-RPC stdio e também precisa de `DEEPSEEK_API_KEY`:

```sh
pnpm run demo:acp
```

### Marcadores TODO

Use uma de três tags de comentário para sinalizar problemas conhecidos no código, ordenadas por urgência:

- `FIXME` — um problema que deveria bloquear um release novo. Um release não deveria sair com um `FIXME` aberto, salvo se os revisores concordarem explicitamente que a mudança pode ser mesclada ainda assim.
- `TODO` — um problema que deveria ser corrigido em breve, assim que tivermos recursos.
- `XXX` — um problema que talvez corrijamos algum dia; prioridade baixa, sem compromisso.

Escolha a tag que casa com a urgência para quem escanear o código distinguir um bloqueador de release de um talvez-um-dia.

### Documentando tipos verbatim (`ts type-equiv`)

As páginas de [subsystems](subsystems/README.md) colam declarações equivalentes à fonte junto com o JSDoc original delas para que o leitor veja a definição exata do tipo e o contrato da fonte. Para impedir que a colagem derive quando a fonte muda, proteja com ` ```ts type-equiv ` (em vez de ` ```ts `) e registre em `scripts/type-equiv.manifest.json` com o arquivo-fonte e o símbolo espelhados:

```json
{ "doc": "docs/subsystems/session.md", "symbol": "SessionEvent", "source": "packages/core/session/src/types.ts" }
```

`pnpm run verify-type-equiv` (parte do `doc-sync`) então extrai a declaração daquele símbolo e o JSDoc anexado da fonte via o parser do TypeScript e afirma que o bloco corresponde aos dois. Para uma classe cujos corpos de implementação não pertencem ao catálogo, use ` ```ts public-api ` e defina `"projection": "public-api"`; a projeção checked-in mantém os campos públicos, constructor, acessors, métodos e o JSDoc original de classes e membros enquanto omite corpos e membros privados ou protegidos. A comparação ignora whitespace e comentários que não são JSDoc, mas exige cada comentário JSDoc original, inclusive a documentação de membros, para que leitores vejam o contrato da fonte ao lado da definição exata do tipo. A gate impõe uma correspondência 1:1 por documento, símbolo e projeção entre blocos primários e entradas de manifest; um bloco `.pt-BR.md` pareado reusa a entrada do irmão sem sufixo apenas quando a sequência inteira de fences rastreada é byte-idêntica e ordenada de forma idêntica. `doc-typecheck` aplica a mesma regra derivada a fences compiláveis, pulando ambos os tipos de fence de equivalência da fonte da compilação e da taxa de opt-out dele. Ao mudar uma declaração documentada ou o JSDoc dela, a gate falha até você atualizar a colagem; ao adicionar ou remover um bloco primário, atualize o manifest na mesma mudança.