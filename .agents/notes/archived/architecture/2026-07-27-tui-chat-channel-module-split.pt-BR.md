# Agent Note: Divisão em módulos do canal de chat do dsh-tui

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-tui-chat-channel-module-split.md) | Português

## Problema

`packages/ui/tui/src/index.ts` tinha passado de 2000 linhas. A maior parte era uma única factory `createTuiChat`: uma closure de ~1600 linhas com cerca de quarenta variáveis mutáveis e outras tantas closures aninhadas. A seleção de modelo, a fila de ask-user-question e a retomada de sessão estavam emaranhadas nesse escopo único, então um leitor não conseguia acompanhar nenhuma dessas responsabilidades sem manter o arquivo inteiro na cabeça, e edições sem relação entre si colidiam. Uma passada anterior tinha agrupado `src/` em `components/`, `session/`, `extension/`, mas o arquivo de entrada em si e os arquivos de entrada de texto soltos no nível superior (`autocomplete.ts`, `file-autocomplete.ts`, `skill-invocation.ts`, `xml-tool-output.ts`) ficaram intocados.

## Decisão

As submáquinas coesas do canal de chat são extraídas de `createTuiChat` para `src/chat/`, cada uma como uma factory que recebe um pacote explícito de dependências em vez de capturar o escopo da entrada:

- `chat/model-command.ts` — `createModelController`: o comando `/model` enfileirado, o overlay de seleção de modelo + esforço de raciocínio e a resolução da janela de contexto do modelo selecionado. É dono do cache de janela de contexto que as views de prompt e de status leem.
- `chat/questions.ts` — `createQuestionQueue`: o provedor de interação com o usuário e os overlays de ask-user-question em FIFO, um por vez.
- `chat/resume.ts` — `createResumeController`: o seletor do `/resume`, as leituras de resumo por candidato, a verificação prévia antes da passagem de controle, a passagem de controle do terminal e o comando durável de dica de retomada.
- `chat/helpers.ts` — helpers sem estado (`formatCwd`, `gitBranch`, derivações de superfície/chamada de ferramenta, cartões de referência de sessão), o `HintEditor` e as constantes de revelação do banner.
- `chat/channel.ts` — `ChatChannelDeps` (a superfície de colaboradores que todo subcontrolador compartilha) e `ChannelNotice` (incorporado pelos controladores que relatam resultados). Cada `*Deps` estende esses dois, então a superfície compartilhada tem uma única definição.

`src/` é reorganizado para que `chat/` guarde toda responsabilidade do canal de chat: os subcontroladores acima, mais os antigos arquivos de entrada de texto e os antigos arquivos de `session/` (`timing.ts`, `tokens.ts`), vão todos para `chat/`. `xml-tool-output.ts` vai para `components/`. As interfaces da fronteira host/processo (`TuiRuntime`, `TuiResumeHost`) vão para `src/runtime.ts`. Depois da divisão, `src/` é `chat/`, `components/`, `extension/` e os arquivos de nível superior `index.ts` / `config.ts` / `prompt.ts` / `runtime.ts` / `invariant.ts`; `index.ts` cai de 2067 para ~1530 linhas e agora constrói e conecta os três controladores.

A convenção para o pacote de dependências de um controlador: os colaboradores de valor estável (`ctx`, `resolved`, `palette`, `overlayManager` e os serviços próprios de cada controlador) são desestruturados uma vez; os callbacks do canal (`appendNotice`, `requestRender`, `isDisposed`, `agentStatus`) ficam em `deps`, para que um controlador sempre chame a implementação atual do canal. O JSDoc de `channel.ts` enuncia essa regra.

## Alternativas consideradas

- **Funções livres que recebem um objeto de contexto mutável compartilhado.** Rejeitada: isso exporia de novo o mesmo amontoado de quarenta campos que a divisão se propôs a remover, só que sob um nome de parâmetro.
- **Extrair também o controlador de animação de status/tempo.** Adiada: `runningStatus` é lido diretamente pela animação do cursor do prompt em `updatePromptValues`, então uma fronteira de controlador ali vazaria seu estado interno de volta por getters, uma separação com vazamento para pouco ganho. Ele continua inline em `index.ts`.

## Consequências

Cada responsabilidade agora pode ser lida e testada isoladamente, e a superfície de dependências compartilhada é definida uma vez em vez de copiada em três interfaces. O custo: `index.ts` constrói os controladores e repassa o pacote de callbacks, e o controlador de modelo é uma referência antecipada com `let` (`updatePromptValues` o captura, mas ele é construído depois, quando `appendNotice`/`overlayManager` já existem), carregando uma desativação justificada de `prefer-const` e uma primeira pintura adiada.

## Testes

O comportamento não muda: todos os testes de pacote existentes e os snapshots da TUI passam sem regravação, e esse é o contrato deste refactor.
