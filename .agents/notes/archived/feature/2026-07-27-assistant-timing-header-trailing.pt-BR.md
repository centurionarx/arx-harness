# Agent Note: A linha de tempos do assistente é renderizada depois do corpo da mensagem

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-assistant-timing-header-trailing.md) | Português

## Problema

A mensagem do assistente na TUI abria com uma única linha de cabeçalho que juntava o rótulo `Assistant` e a string de tempos das etapas (`Assistant · Model wait 0.0s · Completed …`). Colocar os tempos antes do corpo afastava as durações da resposta que elas descrevem e, depois da conclusão, enterrava a primeira linha da resposta sob uma linha de metadados que o leitor pula.

## Decisão

**Separar o rótulo dos tempos; renderizar os tempos como a linha final da mensagem.**

`AssistantMessageComponent` (packages/ui/tui/src/index.ts) agora emite o rótulo `Assistant` em negrito como a primeira linha e anexa a string de tempos dim (já montada por `StreamingAssistantComponent.rebuild()` como `header`, incluindo o sufixo `· Completed …` quando concluída) como o último filho, depois do raciocínio e do texto. O conteúdo dos tempos, a ocultação de buckets e o comportamento do tempo de conclusão não mudam: só a posição passou do topo para o fim da mensagem.

## Alternativas consideradas

**Mover a linha de cabeçalho inteira (rótulo incluído) para o fim.** Rejeitada: o rótulo `Assistant` orienta o leitor sobre quem está falando e pertence ao topo, como o rótulo `You`; só os metadados de tempo se beneficiam da posição final.

**Manter os tempos inline, mas abaixo do rótulo, como uma segunda linha no topo.** Rejeitada: isso ainda separa as durações da resposta concluída e mantém duas linhas de metadados entre o prompt e a resposta.

## Consequências

Cada mensagem do assistente é lida como rótulo → raciocínio → resposta → tempos, então os tempos concluídos ficam ao lado da resposta que medem. A suíte de snapshots sem chave da TUI foi atualizada para fixar o novo layout em todas as fixtures; quatro asserções de `tui.spec.ts` que casavam com a antiga string inline `Assistant · Model wait …` agora verificam o rótulo e os tempos separadamente, já que os dois não são mais renderizados de forma contígua.
