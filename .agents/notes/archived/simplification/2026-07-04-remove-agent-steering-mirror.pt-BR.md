# Agent Note: remover a emissão espelho `agent/steering`

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-remove-agent-steering-mirror.md) | Português

## Problema

`agent/steering` era o último espelho transitório remanescente de um evento de sessão durável. A drenagem de steering (direcionamento no meio da execução) do loop acrescenta ao log o evento durável `steering/message { turn, content, source }` e, logo na linha seguinte, emitia `agent/steering(agent, turn, content, source)`, o fato idêntico como um evento disparado sem acompanhamento (`packages/core/agent-loop/src/loop.ts`, `drainSteering`). Ele tinha zero listeners em produção: o único assinante em qualquer lugar era um teste de regressão do loop que afirmava que a emissão carregava `source`, o mesmo fato que o evento durável já registra uma linha acima.

`agent/steering` duplicava o `steering/message` durável imediatamente anterior, com o mesmo payload. `agent/queued` continua sendo o sinal exclusivamente ao vivo porque dispara antes da persistência e cobre trabalho que pode ser cancelado antes de entrar no log.

O steering carrega tráfego real de produção: as decisões de continuação de turno das pontes de hooks injetam seus motivos por meio de `inbox.steer()`, chegando como eventos duráveis `steering/message` que as saídas esperadas da matriz de hooks fixam, e cada um desses consumidores observa o evento durável. Nada observava o espelho.

## Decisão

`agent/steering` é removido da taxonomia de eventos do agent (agente): a declaração em `packages/core/agent/src/types.ts` (e a menção a ele na lista de eventos ao vivo do JSDoc ali), a emissão em `drainSteering` (cujo parâmetro `ctx`, então sem uso, saiu junto), a linha em `packages/core/agent/README.md` e a linha de emissão nos blocos de pseudocódigo do loop (a documentação de módulo de `packages/core/agent-loop/src/loop.ts` e [architecture.md](../../../../docs/architecture.md)); o catálogo do cordis é regenerado sem ele. O único teste de regressão fixa a preservação da origem no evento durável `steering/message`: o fato que ele fixa vive no log.

Três Agent Notes implementadas declaravam a retenção, e cada uma é emendada conforme [implemented/AGENTS.md](../AGENTS.md) para apontar para cá como o registro da remoção: a entrada da lista de retidos da [Agent Note de fronteira](2026-06-20-remove-agent-boundary-mirror-events.md), a cláusula de escopo da [Agent Note de stream-chunk](2026-07-02-remove-stream-chunk-mirror.md) e a enumeração de emissões transitórias da [Agent Note de semântica de domínios de evento](../architecture/2026-06-30-event-domain-semantics.md).

## Alternativas consideradas

### Por que não mantê-lo?

"It is a control signal, not a boundary": mas a distinção operante da taxonomia é entre espelhado e exclusivamente ao vivo, não entre controle e fronteira, e este evento espelhava. Um consumidor que quer notificação no momento do enfileiramento tem `agent/queued` (com sua flag de steering); um consumidor que quer notificação no momento da drenagem está, por definição, pedindo o momento em que `steering/message` é acrescentado ao log, que `session/event` entrega com o mesmo payload mais a durabilidade. A [Agent Note rejeitada de aposentar o steering no meio do turno](../../rejected/simplification/2026-06-20-retire-mid-turn-steering.md) defendia a *capacidade* de steering (`steer()`, o evento durável, a continuação forçada), que esta remoção mantém toda intocada.

## Verificação

A grafia `agent/steering` sobrevive apenas na prosa de Agent Notes (esta Agent Note, as três Agent Notes emendadas acima e a [Agent Note rejeitada da capacidade de steering](../../rejected/simplification/2026-06-20-retire-mid-turn-steering.md), congelada, cujo texto registra a proposta que ela recusou); o catálogo é regenerado; o teste redirecionado fixa a preservação da origem em `steering/message`.

## Consequências

Não existia nenhum listener de produção para migrar, e as duas necessidades de notificação ao vivo mantêm lugares que sobrevivem: o momento do enfileiramento em `agent/queued` (com sua flag `steering`) e o momento da drenagem em `session/event`, quando o `steering/message` durável chega.
