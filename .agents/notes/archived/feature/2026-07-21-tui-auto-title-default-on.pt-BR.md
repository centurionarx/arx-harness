# Agent Note: Título automático ativado por padrão e derivado de novo na retomada

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-auto-title-default-on.md) | Português

> **Substituída** pela [Agent Note de consolidação do título de sessão](../simplification/2026-07-22-tui-titles-from-session-title-service.md): a geração `autoTitle` local da TUI foi removida; os títulos vêm do serviço de título de sessão apoiado no log, e a renomeação do terminal consome eventos `session/title`.

## Problema

A [Agent Note do título automático](2026-07-21-tui-auto-pane-title.md) entregou `autoTitle` desativado por padrão e, em uma sessão retomada, manteve o título estático porque a primeira `user/message` já estava no log. No uso, as duas escolhas frustraram o propósito da funcionalidade. Um título de painel descritivo por sessão é o que torna um painel do tmux ou uma aba de terminal distinguível do seguinte; deixá-lo desativado por padrão significa que o produto entrega uma funcionalidade inerte que quase nenhum usuário ativa, e pular a nova derivação na retomada significa que uma sessão retomada, exatamente a sessão de longa duração que mais vale a pena rotular, recai na string estática compartilhada. O usuário pediu que um nome descritivo por sessão fosse a experiência normal.

## Decisão

- `autoTitle` vem **ativado** por padrão (`z.boolean().default(true)`, espelhado pelo `?? true` de `resolveTuiConfig`). Um deploy com um serviço `llm` e um provedor/modelo de agent (agente) recebe um título de painel feito pelo modelo em toda sessão, sem precisar optar por isso; um deploy sem eles mantém o título estático, de modo que a ativação por padrão é inerte onde a chamada não pode ser executada.
- Uma sessão **retomada** deriva o título de novo na montagem, a partir da primeira `user/message` já registrada no log: `createTuiChat` varre `agent.session.events` em busca do primeiro evento desse tipo e entrega o texto dele ao mesmo `generateTitle` de disparo único. O título nunca é persistido (o cabeçalho da sessão não tem campo de título), então é sempre derivado, nunca restaurado.
- A trava de disparo único agora é simplesmente `titleSettled = !resolved.autoTitle`. A cláusula anterior, que dava o título por resolvido de antemão na retomada, deixou de existir: na retomada, `generateTitle` roda uma vez a partir da primeira mensagem armazenada e então trava, de modo que uma mensagem que chega *depois* da retomada não gera novo título. Uma sessão nova não tem `user/message` armazenada na montagem, então a varredura de retomada não faz nada e o listener ao vivo de `session/event` é que dá título à primeira mensagem.
- Todo o restante da [Agent Note do título automático](2026-07-21-tui-auto-pane-title.md) continua valendo sem alteração: o caminho OSC 0 de `runtime.terminal.setTitle`, o formato do resumo do modelo (de duas a cinco palavras em minúsculas, primeira linha não vazia, limite de 40 caracteres), a chamada `ctx.llm.stream` disparada sem aguardar resultado, que nunca toca a sessão nem o transcript (registro textual da sessão), o `AbortController` de encerramento e todos os fallbacks de falha (resposta vazia, `llm` ausente, provedor/modelo ausente, prompt só com espaços em branco).

## Alternativas consideradas

**Manter a funcionalidade desativada por padrão.** Rejeitado: esta é uma reversão direta, a pedido do usuário, da decisão "desativado por padrão" da [Agent Note do título automático](2026-07-21-tui-auto-pane-title.md). Desativada por padrão, a funcionalidade é entregue inerte; o nome descritivo só é útil se for a experiência normal. A preocupação com o replay sem chave, que motivou a desativação por padrão, é resolvida fixando `autoTitle: false` nos cenários de snapshot apoiados em replay, em vez de suprimir a funcionalidade em todo deploy.

**Persistir o título derivado no cabeçalho da sessão.** Rejeitado: o cabeçalho não tem campo de título, e adicionar um transformaria um rótulo de terminal em metadado de sessão, a fronteira que a [Agent Note do título automático](2026-07-21-tui-auto-pane-title.md) já traçou em relação ao trabalho de título de sessão apoiado no log. Derivar de novo a partir da primeira mensagem armazenada custa uma chamada sem ferramentas na retomada e mantém o rótulo como função pura da conversa.

**Derivar de novo na retomada a partir da mensagem mais recente, e não da primeira.** Rejeitado: o título resume *do que* a sessão trata, e isso o pedido de abertura captura; uma mensagem do meio da conversa faria o rótulo do painel se deslocar à medida que o trabalho avança.

## Consequências

- Uma sessão nova com um `llm` funcional agora gasta, por padrão, uma chamada extra ao modelo, sem ferramentas (antes, só quando o usuário optava por isso); uma sessão retomada gasta uma na montagem. Os deploys sem `llm` ou sem provedor/modelo não são afetados.
- O `examples/tui-agent/tests/tui.snapshot.ts`, apoiado em replay, precisa optar por **não** usar a funcionalidade: ele fixa `autoTitle: false`, porque uma requisição de título ativada por padrão não está entre os turnos gravados e `installLlmReplay` falha de forma ruidosa diante de uma requisição não gravada. O `packages/ui/tui/tests/tui.snapshot.ts` unitário não precisa de opt-out: ele não monta nenhum serviço `llm`, então `generateTitle` retorna de imediato e a inversão do padrão é inerte ali. O `examples/tui-agent/cordis.yml` interativo e a fixture (dados de teste pré-montados) de PTY roteirizada já definem `autoTitle: true`, então a asserção de OSC 0 do teste de fumaça sem chave não muda.
- `packages/ui/tui/tests/tui.spec.ts` fixa os novos padrões: o teste de padrão de configuração espera `autoTitle: true`; o teste do caminho desativado agora define `autoTitle: false` explicitamente; e o antigo teste "resumed session never fires" foi reescrito para verificar a nova derivação a partir da primeira mensagem armazenada e que uma mensagem ao vivo posterior não gera novo título. `docs/config-catalog.md` é regenerado com "On by default".
