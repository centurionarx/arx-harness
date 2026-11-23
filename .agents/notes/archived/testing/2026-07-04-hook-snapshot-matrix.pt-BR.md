# Agent Note: Matriz de snapshots de hooks — saídas esperadas de ponta a ponta para os dois bridges

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-hook-snapshot-matrix.md) | Português

## Problema

Os bridges de hooks, [`dsh-hooks-claude`](../../../../packages/hooks/hooks-claude) (7 pontos de hook do Claude Code) e [`dsh-hooks-codex`](../../../../packages/hooks/hooks-codex) (5 pontos do Codex), mapeiam comandos de hook externos para os seams de interceptação do harness. Eles têm cobertura profunda de testes unitários e de specs de cobertura (todo ramo de decisão, todo dialeto de payload, acionados contra um seam com mock), mais um e2e condicionado a chave (`hooks.e2e.ts`, um bloqueio de `PreToolUse` ao vivo). Mas a camada de snapshot do transcript (registro textual da sessão) completo, a única rede que sobe o subprocesso `acp-agent` real, faz replay sem chave de uma sessão gravada e compara o stdout ACP (Agent Client Protocol) normalizado mais o log persistido de novo com as saídas esperadas versionadas, cobria exatamente UM hook: um bloqueio de `UserPromptSubmit` do Claude (`hook-cc-promptsubmit-block`).

Essa é a camada que um teste unitário com mock estruturalmente não consegue ser: ela exercita o bridge REAL traduzindo o resultado de um processo de hook REAL na decisão REAL do seam, e depois a reação do loop REAL pelo canal de automação e pelo log persistido. Uma regressão na tradução do bridge ou na estrutura do loop que deixasse todos os testes unitários verdes ainda escaparia dela em todos os pontos de hook menos um; e, no caso do bridge do Codex, o exemplo ACP nem sequer o CARREGAVA, então nenhum hook do Codex conseguia disparar de ponta a ponta.

## Decisão

A implementação tem duas partes acopladas:

### 1. O exemplo ACP distribui OS DOIS bridges de hooks

`examples/acp-agent/cordis.yml` e `cordis.snapshot.yml` agora carregam `dsh-hooks-codex` ao lado de `dsh-hooks-claude`, cada um apontado para o seu próprio arquivo de configuração (`./hooks.json` para o Claude, `./codex-hooks.json` para o Codex; os dois dialetos não podem compartilhar um arquivo). Esta é uma mudança genuína de superfície de produto, não uma ligação exclusiva de teste: o servidor ACP distribuído (e a porta de entrada `demo:acp`) agora carrega os dois bridges.

Isso é seguro porque um bridge cujo arquivo de configuração está ausente é um **no-op silencioso**: `apply()` captura a falha de leitura, registra em log por `ctx.logger` e não registra nada: zero listeners, zero eventos de sessão. A aplicação `acp-agent` não distribui nenhum logger de stdout, então o aviso não consegue chegar ao canal JSON-RPC do ACP. Um cenário (ou um projeto real) que quer apenas hooks do Claude distribui apenas `hooks.json`; o bridge do Codex não encontra nenhum `codex-hooks.json` e desaparece. Isso foi verificado empiricamente: com os dois bridges carregados, todos os snapshots preexistentes (nenhum dos quais distribui um `codex-hooks.json`) ficam byte-idênticos.

Carregar os dois é o mínimo que permite à camada de snapshot exercitar cada dialeto contra a mesma aplicação real que o produto distribui. A gravação (que sobe `cordis.yml`) carrega os dois por construção, e o replay os herda da mesma forma: `cordis.snapshot.yml` é um overlay por include de `cordis.yml` que troca apenas a entrada de llm (veja [single-source the acp-agent replay config](2026-07-04-single-source-acp-replay-config.md)), então um bridge acrescentado à árvore ao vivo está na árvore de replay sem uma segunda edição.

### 2. Um cenário de snapshot por ponto de hook × o seu resultado principal, nos dois dialetos

Treze cenários em `examples/acp-agent/tests/snapshots/`, nomeados `hook-<dialect>-<point>-<outcome>`:

- **Escritos à mão, sem turno de modelo** (sem chave, sem sidecar: o script de replay derivado é vazio; compara-se o turno `rejected` que carrega os eventos `hook/*`): `hook-cc-promptsubmit-block`, `hook-codex-promptsubmit-block`.
- **Gravados contra a API real, com o hook ativo durante a gravação** (a reação do modelo à decisão faz parte do transcript capturado, e o replay dele passa a ser feito sem chave): `hook-{cc,codex}-promptsubmit-context` (allow + incorporação de additionalContext), `hook-cc-pretool-deny` / `hook-codex-pretool-block` (deny → resultado de ferramenta com `isError`), `hook-cc-pretool-ask` (ask → degrada para deny com o motivo de aprovação obrigatória), `hook-{cc,codex}-posttool-block` (block com feedback), `hook-{cc,codex}-posttool-context` (accept + additionalContext), `hook-{cc,codex}-stop-continue` (um hook Stop bloqueante força uma etapa extra via steering).

Cada comando de hook emite apenas strings LITERAIS FIXAS (sem timestamps/pids/`$RANDOM`/ecos de cwd); o normalizador de snapshots limpa o único campo volátil que um `hook/result` carrega (`durationMs`). Os cenários de `Stop` se autolimitam com um arquivo marcador (`.stop_fired`) para que a continuação forçada não entre em loop: a proteção contra loop `stop_hook_active` ainda é um `TODO` do bridge, então um hook Stop incondicional forçaria a continuação a cada etapa.

Os cenários de bloqueio de `PostToolUse` se autolimitam no mecanismo que provam. O hook do Claude persiste um marcador no workspace depois da primeira rejeição, então uma chamada de recuperação é permitida; o prompt do Codex faz uma chamada e relata o resultado injetado. Cada saída esperada fixa uma chamada bloqueada, sem ciclos repetidos de bloqueio/nova tentativa.

### Três pontos de hook deliberadamente NÃO têm snapshot

Descobertos durante a construção da matriz e documentados aqui porque a omissão é uma decisão, não um descuido:

- **`SessionStart` e `SubagentStart`** injetam contexto por um `void runPoint(...).then(agent.inject())` desacoplado e de melhor esforço, SEM vínculo com um turno. O `context/message` resultante disputa uma corrida com o trabalho que ele antecede (a primeira requisição ao modelo / o primeiro turno do filho) e cai em uma posição não determinística do log. Uma saída esperada gravada nem sequer se reproduz no próprio replay: uma verificação de estabilidade com 10× replays falhou 10/10 nos dois. Eles ficam na cobertura unitária dos bridges, que aciona o seam diretamente sem a corrida de tempo. (Se a injeção algum dia passar a ser vinculada a um turno e determinística, a direção para a qual o `TODO(session-start-gating)` aponta, eles passam a aceitar snapshot.)
- **`SubagentStop`** é apenas de observação: seu handler de `subagent/end` não passa nenhum turno (logo, não há eventos de log `hook/*`) e não faz injeção. Ele não escreve NADA no transcript, então uma saída esperada seria byte-idêntica à execução sem hook e nunca seria possível provar que ela falha: uma guarda que não consegue morder. Ele fica na cobertura unitária (`bridge.spec.ts` já verifica a chamada apenas de observação).

A matriz cobre, portanto, todo ponto de hook que tem uma pegada DETERMINÍSTICA e OBSERVÁVEL no transcript, nos dois dialetos.

## Consequências

- Todo mapeamento de seam dos bridges com um transcript observável agora está protegido na camada de transcript completo, na aplicação real, nos dois dialetos, incluindo o bridge do Codex, que não tinha nenhuma cobertura de ponta a ponta. As saídas esperadas gravadas capturam a reação real do modelo a um turno negado/bloqueado/com continuação forçada, coisa que um transcript escrito à mão só poderia adivinhar.
- Os cenários de bloqueio de `UserPromptSubmit` são escritos sem chave (sem turno de modelo); os demais fazem replay sem chave a partir de fixtures (dados de teste pré-montados) gravadas. `pnpm run test:snapshot:record` regenera as fixtures gravadas a partir da API ao vivo e se autoignora sem chave, como todo cenário gravado.
- A disciplina de provar o vermelho se mantém: adulterar a saída de uma configuração de hook (por exemplo, mudar um motivo de deny) deixa o cenário correspondente vermelho no replay. O processo de hook roda DE VERDADE durante o replay (só o modelo passa por replay), então a saída esperada protege o caminho real hook→seam→loop, não um mock dele.
- A demo `acp-agent` agora carrega um bridge do Codex que normalmente será um no-op (não há `codex-hooks.json` em um projeto típico), o que é o comportamento tolerante a falhas pretendido, não um custo.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
