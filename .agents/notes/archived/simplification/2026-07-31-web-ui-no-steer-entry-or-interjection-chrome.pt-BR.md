# Agent Note: A UI Web remove a entrada de steering e o chrome de interjeição

Status: implemented
Archived: 2026-08-07

[English](2026-07-31-web-ui-no-steer-entry-or-interjection-chrome.md) | Português

## Problema

O steering (direcionamento no meio da execução) durante o turno é uma capacidade de host/agent loop (ciclo do agent) (`mode:'steer'`, um `user/message` durável). O produto Web já travava o composer enquanto um turno estava em execução e nunca entregou um menu de queue/steer, mas o cliente ainda propagava `'queue' | 'steer'` pela máquina de entrada, por `conversation.send` e pelas chaves de locale, e renderizava o steering consumido como uma bolha com o badge "Interjeição"/"Interjection". Isso deixava uma superfície de UI pela metade: um modo de envio sem uso, um rótulo de produto para um gesto que os usuários não conseguem executar e goldens de e2e que fixavam um chrome que não pertence ao produto.

## Decisão

Manter intacto o steering do host e do runtime. Remover apenas a entrada e o chrome da UI Web:

- `InputMachine` / `SessionInput` / `InputActions.submit` / o `defaultSink` do hub ficam somente com fila; sempre chamam `session.prompt(..., 'queue')`.
- `ConversationService.send(text)` perde o argumento de modo e sempre enfileira.
- O conteúdo durável de steer é renderizado como uma bolha simples alinhada à direita (sem badge, sem IconActions de usuário), para que os steers externos ou do host continuem visíveis no replay.
- Excluir as strings de locale `message.steering` e o CSS de badge sem uso.
- O e2e de steering da Web continua fazendo POST de `mode:'steer'` em `/api/session.prompt` e verificando a obediência durável e visível ao modelo; ele não espera mais o chrome de interjeição. Atualizar as linhas de fatos da [nota da máquina de entrada da Web](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.md) para corresponder.

## Alternativas consideradas

**Excluir por completo o steering do host.** Fora de escopo; o usuário pediu apenas a exibição e a entrada na UI Web. A drenagem do agent loop, os eventos de sessão e o modo no formato de transmissão (wire format) continuam essenciais para ACP (Agent Client Protocol)/TUI/automação.

**Ocultar do transcript (registro textual da sessão) o conteúdo durável de steer de `user/message`.** Mentiria no replay quando um cliente externo faz steering; rejeitada em favor de uma bolha simples.

**Manter o parâmetro de modo, mas passar sempre apenas `'queue'`.** Deixa uma superfície de API morta e testes que inventam caminhos `'steer'` que o composer não consegue alcançar.

## Consequências

- **Parcialmente substituída.** Os itens 1 e 3 a 5 da Decisão não descrevem mais o master: o steering pelo composer foi entregue depois, e a [decisão sobre fonte de contexto e marcas de steer](../feature/2026-08-04-web-context-source-and-steer-marks.md) é dona da legenda dele. Os fatos atuais vêm a seguir.
- A propriedade do steering do host não mudou: a drenagem do agent loop, os eventos de sessão e o modo no formato de transmissão continuam essenciais para ACP, automação e clientes que não são Web.
- `ConversationService.send(text)` continua sem receber modo e sempre enfileira; o gesto Steer do composer usa `session.prompt(mode: 'steer')` em vez disso.
- O conteúdo durável de steer de `user/message` continua sendo incorporado ao transcript, de modo que um steer enviado externamente permanece fiel no replay. Agora ele carrega a legenda de interjeição em vez de ser renderizado como uma bolha nua.
- Os itens de próxima etapa que não são do usuário (contexto de `agent.inject`: avisos de aprovação, conclusão de tarefas, snapshots anexados) são transmitidos com o posicionamento `context` e nunca são renderizados como bolhas de steering pendente; eles ficam invisíveis até serem reivindicados como cartões de contexto duráveis de `user/message`.

## Testes

- Cobertura unitária/jsdom de `packages/client/ui-conversation`: enter/sink da máquina de entrada, roteamento do ConversationService, o ramo de steering do MessageItem, envio do InputBar.
- Replay sem chave de `apps/web/tests/steering.e2e.ts` mais os goldens dele, que fixam a legenda.
- O teste de projeção `session/queue` de `packages/host/apiproxy` verifica que os itens de próxima etapa de origem do usuário permanecem como `steering`, enquanto os itens de origem de plugin chegam como `context`.
