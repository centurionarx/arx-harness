# Agent Note: Parar de espelhar o stream de tokens como um evento de agent

Status: implemented
Archived: 2026-07-27

[English](2026-07-02-remove-stream-chunk-mirror.md) | Português

## Problema

O loop registra cada delta de token do modelo como um evento de sessão durável `assistant/chunk` E emitia, em paralelo, um evento ao vivo do Cordis, `agent/stream-chunk`, que carregava dados idênticos. Em `packages/core/agent-loop/src/agent.ts`, os dois ficavam a uma linha de distância:

```ts ignore-check
const chunkEvent = session.append('assistant/chunk', { turn, step, chunk })
chunkSeqs.push(chunkEvent.seq)
ctx.emit('agent/stream-chunk', agent, turn, step, chunk)   // ← the mirror
```

- Durável: `assistant/chunk: { turn, step, chunk }`.
- Emit ao vivo: `agent/stream-chunk(agent, turn, step, chunk)`, com o mesmo `StreamChunk` e os mesmos `turn`/`step`.

A única coisa que o emit acrescentava ao evento de sessão era o handle ao vivo do `Agent`, e o único consumidor o descartava (a assinatura do handler dele era `(_agent, _turn, _step, chunk)`).

Esta é a mesma duplicação que a [remoção dos espelhos de fronteira](2026-06-20-remove-agent-boundary-mirror-events.md) eliminou para as fronteiras de turno/etapa: um consumidor tinha duas fontes da verdade para um único fato durável, e toda mudança precisava tocar as duas. Aquela Agent Note adiou o stream de chunks ("a persistência de `assistant/chunk` continua essencial, então o stream de chunks poderia ser avaliado mais tarde como um espelho, mas essa é uma decisão separada") em vez de incluí-lo no mesmo pacote. Esta Agent Note é essa decisão separada.

A premissa da qual o adiamento dependia está resolvida: a persistência de chunks é a fonte autoritativa e vai ficar. A proposta de parar de persistir os chunks e manter apenas um evento de stream ao vivo e transitório foi [rejeitada](../../rejected/simplification/2026-06-20-assembled-assistant-messages-only.md): o replay de alta fidelidade, os streams parciais que falharam e o replay de snapshot dependem todos do feed `assistant/chunk` persistido. Portanto, `assistant/chunk` em `session/event` é o stream de tokens durável e essencial, e `agent/stream-chunk` é um espelho puramente redundante dele.

## Decisão

Remover `agent/stream-chunk` da taxonomia de eventos de agent. O stream de tokens é lido de `session/event` como `assistant/chunk`, o mesmo feed que a persistência e o replay já usam: `session/event` é o único stream ao vivo do transcript (chunks do assistente, fronteiras de turno/etapa, atividade de ferramentas, todos).

**Consumidores.** A persistência, o replay e os renderizadores interativos consomem diretamente o stream autoritativo da sessão. A [ponte ACP exclusiva para automação](2026-07-23-acp-automation-only-protocol.md) emite o texto de `assistant/message` já confirmado, e não chunks brutos, então não precisa de nenhum dos dois eventos. Nenhum consumidor de produção exige um espelho de tokens que tenha o `Agent` como primeiro argumento.

## Escopo

Removido: `agent/stream-chunk`.

Não alterados:
- `assistant/chunk` (o evento de sessão durável): o stream de tokens autoritativo, mantido exatamente como está. Esta Agent Note remove o ESPELHO AO VIVO, não a persistência (a proposta de remoção da persistência foi rejeitada separadamente; veja acima).
- `agent/steering`: não alterado por ESTA decisão (é um sinal de controle, não o stream de tokens). O gêmeo durável dele é `steering/message`, e o emit espelho foi removido pela própria continuação: [Remover o emit espelho de `agent/steering`](../../archived/simplification/2026-07-04-remove-agent-steering-mirror.md).
- `agent/status`, `agent/error`, `agent/created`/`agent/disposed`, `agent/queued`, `agent/session-start`: eventos de ciclo de vida/controle que não são dados de transcript e não têm duplicata durável.

## Alternativas consideradas

**Remover a persistência e manter apenas um stream ao vivo e transitório**: o corte inverso, [rejeitado separadamente](../../rejected/simplification/2026-06-20-assembled-assistant-messages-only.md). O replay de alta fidelidade, os streams parciais que falharam e o replay de snapshot dependem todos do feed `assistant/chunk` persistido. Com isso resolvido, o emit ao vivo é a metade redundante do par.

## Consequências

Um plugin não consegue mais observar deltas de token a partir de um evento que tenha o `Agent` como primeiro argumento. Ele assina `session/event`, filtra `assistant/chunk` e, quando necessário, busca diretamente o handle ao vivo correspondente com `ctx.agents.get(session.id)`. Nenhum consumidor de produção precisava do `Agent` ao vivo no momento do chunk; esta é a mesma troca aceitável que a remoção dos espelhos de fronteira fez.
