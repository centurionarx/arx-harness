# Agent Note: A TUI apresenta um motivo para todo tipo de fim de turno

Status: implemented
Archived: 2026-08-04

[English](2026-07-24-tui-turn-end-stop-reason-notices.md) | Português

## Problema

A TUI renderizava avisos no transcript (registro textual da sessão) para os fins de turno `error`, `aborted`, `max-tokens`, `rejected` e `interrupted`, mas um fim de turno `disposed` e qualquer tipo de `TurnEndReasonMap` adicionado por plugin não renderizavam nada. Quando um turno assim terminava, ao vivo ou em replay de um log persistido, o agent (agente) parava de trabalhar sem motivo visível, quebrando a expectativa de produto de que toda parada é explicada ao usuário.

## Decisão

O caso `turn/end` em `packages/ui/tui/src/index.ts` faz switch no discriminante do motivo e cobre todos os tipos: `completed` continua em silêncio porque a mensagem final do assistente e seu cabeçalho de tempo `Completed` já apresentam esse resultado; `disposed` acrescenta `Turn stopped: the agent was disposed.`; e o default, extensível por merge, acrescenta `Turn ended: <kind>.`, para que um resultado desconhecido adicionado por plugin ainda nomeie por que o agent parou. Todos os outros tipos mantêm seus avisos existentes.

## Alternativas consideradas

**Um aviso também para turnos `completed`.** Rejeitada por ser ruído: toda resposta comum ganharia uma linha redundante, e a mensagem do assistente mais seu cabeçalho de tempo congelado já marcam a conclusão.

**Suprimir ao vivo o aviso de fim de turno `disposed` porque `agent/disposed` também acrescenta `Agent "<id>" was disposed.`** Rejeitada: os dois avisos enunciam fatos diferentes (este turno foi interrompido antes do fim vs. o agent não existe mais), e o aviso de fim de turno é o único que sobrevive ao replay de um log persistido, no qual a emissão ao vivo de `agent/disposed` não se repete.

**Manter o ramo default em silêncio (o comportamento anterior).** Rejeitada: um tipo extensível por merge desconhecido para a TUI é exatamente o caso em que o usuário não tem outro meio de saber por que o agent parou.

## Consequências

- Um turno nunca termina sem um motivo visível ao usuário na TUI: todo tipo de `turn/end` diferente de `completed` acrescenta um aviso no transcript, incluindo, pelo nome, tipos desconhecidos adicionados por plugin.
- O dispose ao vivo durante um turno em execução mostra dois avisos (o aviso de fim de turno mais `agent/disposed`); um log em replay mostra só o aviso de fim de turno.
- O snapshot `errors-and-help` fixa os avisos de `disposed` e de tipo desconhecido ao lado dos avisos de falha e de interrupção existentes.
