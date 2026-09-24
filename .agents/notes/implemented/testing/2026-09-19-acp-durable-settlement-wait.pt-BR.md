# Nota de Agente: Esperar turnos de conclusão duráveis nos snapshots ACP

Status: implemented

[English](2026-09-19-acp-durable-settlement-wait.md) | Português

## Problema

A conclusão de um agente filho em segundo plano pode abrir e fechar o segundo turno do pai entre consultas à persistência. Esperar que esse turno permaneça aberto deixa de observar trabalho concluído e esgota o prazo mesmo quando a transcrição já está durável.

## Decisão

O [harness de snapshots](../../../../packages/test-support/acp-snapshot/src/harness.ts) aceita `minimumTurn` em `waitForTurnEnd`. Ele exige tanto que o último turno esteja fechado quanto um registro persistido de fechamento do turno solicitado. A [fixture continuável](../../../../examples/acp-agent/tests/snapshots/subagent-continuable/input.json), a [fixture de herança continuável](../../../../examples/acp-agent/tests/snapshots/subagent-continuable-inheritance/input.json), a [fixture de `report`](../../../../examples/acp-agent/tests/snapshots/subagent-report/input.json) e a [fixture de `list_agents`](../../../../examples/acp-agent/tests/snapshots/subagent-list-agents/input.json) esperam diretamente o fechamento do turno 2. `waitForTurnStart` mantém sua semântica de turno aberto para sincronizar cancelamentos.

## Alternativas consideradas

**Aumentar o prazo.** Um turno concluído nunca volta a ficar aberto; esperar mais não recupera a observação perdida.

**Aceitar qualquer turno fechado.** O primeiro turno do pai pode fechar antes da chegada do resultado em segundo plano, permitindo coletar a transcrição antes da conclusão que o teste verifica.

## Consequências

As quatro fixtures aceitam uma conclusão já persistida e rejeitam um turno anterior fechado. As fixtures de `report` e de `list_agents` enviam o prompt seguinte somente depois que o turno 2 fecha. As comparações de transcrição, o prazo padrão de 30 segundos, a prontidão de cancelamento e o descarte em execução permanecem inalterados.
