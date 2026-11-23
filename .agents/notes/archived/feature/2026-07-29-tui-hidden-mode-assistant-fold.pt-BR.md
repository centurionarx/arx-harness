# Agent Note: O modo oculto da TUI funde as etapas do assistente de um turno em uma única mensagem

Status: implemented
Archived: 2026-08-04

[English](2026-07-29-tui-hidden-mode-assistant-fold.md) | Português

## Problema

A fase oculta do Ctrl+O ([apresentação consolidada da TUI](../architecture/2026-07-28-consolidated-tui-presentation.md)) remove os cartões de ferramenta para que o transcript seja lido como uma conversa, mas cada etapa do modelo ainda renderizava seu próprio cabeçalho `Assistant`. Um turno de várias etapas (texto → ferramentas → texto) mostrava, portanto, vários blocos `Assistant` consecutivos sem nada entre eles — os cartões de ferramenta removidos eram a única coisa que justificava os cabeçalhos repetidos. A leitura só de conversa, no estilo do Codex, pede uma mensagem do assistente por turno.

## Decisão

O modo oculto é também uma regra de fusão, aplicada puramente como apresentação da TUI: por turno, a primeira etapa cujo conteúdo renderizado é visível (texto, ou raciocínio enquanto a exibição de raciocínio está ligada) é dona do único cabeçalho `Assistant` do turno; todas as outras etapas são renderizadas como continuação sem cabeçalho, e uma etapa sem corpo visível não renderiza nada — uma etapa só de ferramentas não consome o cabeçalho nem deixa um segmento em branco. As fases recolhida e expandida mantêm os cabeçalhos por etapa; sair do modo oculto os restaura.

Mecânica: `StreamingAssistantComponent` carrega sua `StepPosition` e uma flag de apresentação `setFoldedContinuation`; `createTuiChat` mantém uma lista por turno dos componentes de etapa e deriva a fusão de novo no Ctrl+O, a cada chunk de texto/raciocínio recebido por streaming, na consolidação da mensagem e na retração de um stream que falhou (o que pode passar o cabeçalho para a etapa seguinte). A reconstrução do transcript limpa o mapa e faz replay do log, de modo que retomada, substituição por compactação (compaction), redimensionamento e trocas de tema convergem para a mesma fusão. Os rodapés de tempo das etapas mantêm sua posse por etapa e não são afetados.

## Alternativas consideradas

- **Unir as etapas em um único componente** — colide com o ciclo de vida de streaming por etapa, com a retração em novas tentativas e com os rodapés de tempo; a flag nos componentes existentes muda apenas o cabeçalho/espaçador.
- **Fundir no log da sessão ou em `deriveMessages`** — altera o histórico durável/visível ao modelo por causa de um modo de leitura da UI; o log continua organizado por etapa.
- **Fundir sempre (em todas as fases de visibilidade)** — as fases recolhida/expandida intercalam cartões de ferramenta entre as etapas, e ali os cabeçalhos por etapa delimitam qual saída pertence a qual etapa.

## Consequências

O modo oculto agora é lido como uma mensagem do assistente por turno; os turnos continuam separados por seus cabeçalhos. A fusão é estado recalculado, nunca armazenado, então nenhum formato de sessão ou de persistência muda. Cobertura: specs unitárias da TUI para as contagens de cabeçalho no ciclo do Ctrl+O, a passagem do cabeçalho quando a primeira etapa é só de ferramentas, a separação por turno e a convergência entre streaming ao vivo e reconstrução; o snapshot sem chave `tool-cards-hidden-folded` fixa o quadro fundido.
