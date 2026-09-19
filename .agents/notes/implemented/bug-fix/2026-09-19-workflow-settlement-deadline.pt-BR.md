# Agent Note: Aplicar prazos de workflow na conclusão

Status: implemented

[English](2026-09-19-workflow-settlement-deadline.md) | Português

## Problem

Um workflow pode terminar trabalho externo depois que seu orçamento de duração expira. Verificar apenas a admissão da etapa ou um temporizador do executor permite que um consumidor direto do domínio informe conclusão bem-sucedida da execução fora desse orçamento.

## Decision

O serviço de projetos verifica o prazo persistido dentro da mutação serializada de conclusão, após validar a versão do agregado e a propriedade da sessão filha. Uma etapa bem-sucedida informada no prazo ou depois dele deixa a execução em falha com seu erro de prazo existente. A etapa mantém seu resultado real e horário de conclusão; uma falha de etapa informada mantém seu próprio erro.

Isso amplia a aplicação das regras descritas em [orquestração durável de projetos](../feature/2026-09-12-durable-project-orchestration.md), cujas decisões sobre agregado, proveniência e recuperação continuam aplicáveis.

## Alternatives considered

- Depender do cancelamento pelo executor permite que consumidores diretos e manuais contornem o orçamento de duração.
- Rejeitar a conclusão sem persistir mantém a reserva da execução ativa e perde um resultado externo conhecido.
- Marcar como falha ou reiniciar uma etapa concluída com sucesso favorece efeitos externos duplicados após um aumento explícito da duração.

## Consequences

A conclusão terminal libera a reserva ativa. Um operador pode aumentar a duração e continuar as dependências pendentes sem repetir etapas concluídas. A aplicação da regra no domínio registra a falha de política; ela não pode desfazer efeitos externos já concluídos por um consumidor.

## Verification

Regressões com o backend JSON real cobrem conclusão bem-sucedida antes, no momento e depois do prazo; rejeição de versão desatualizada; persistência após recarga; liberação de reserva; e continuação explícita que preserva trabalho concluído e entradas das dependências.
