# Agent Note: Custos de renderização da TUI em sessões longas — varredura compartilhada de tempos de etapa e caches de linhas dos cartões

Status: implemented
Archived: 2026-08-04

[English](2026-08-03-tui-long-session-render-costs.md) | Português

## Problema

Em uma sessão longa retomada (196 mil eventos, 2,2 mil etapas, 1,8 mil cartões de ferramenta), a TUI levava ~12 s para renderizar o transcript (registro textual da sessão) e ~800 ms para ecoar uma única tecla. O profiling atribuiu os dois custos ao caminho de renderização, não ao carregamento da sessão (zstd + parse + semeadura da superfície levam ~1,7 s):

- O rodapé de tempos de cada etapa chamava `stepTimingAt`, que fazia replay do log de eventos inteiro a partir do índice 0 para cada rodapé: O(etapas × eventos) na renderização inicial, ~6 s de CPU.
- O pi-tui renderiza de novo todos os componentes a cada quadro e depende de caches de linhas por componente (o cache próprio de `Text`/`Markdown`, indexado por `(text, width)`). `ToolCardComponent.render()` e `ContextCardComponent.render()` construíam instâncias descartáveis de `new Text(...)`/`new Markdown(...)` dentro de `render(width)`, de modo que cada quadro, ou seja, cada tecla, refazia a quebra de linhas da saída de todos os cartões já assentados.

## Decisão

`packages/ui/tui/src/chat/timing.ts` substitui `stepTimingAt` por `StepTimingTracker`: um acumulador por montagem do chat, criado em `createTuiChat` e passado por `StreamingAssistantComponent` até cada `StepTimingComponent`. Uma consulta avança um cursor sobre os eventos acrescentados desde a consulta anterior e mantém em um mapa o estado dos buckets por etapa, de modo que todos os rodapés juntos custam O(eventos). O bucket aberto é acumulado até o relógio da consulta no momento da busca, e uma etapa fica fixada no seu `step/end`. O tracker exige o log de sessão append-only (o contrato `seq = log length`).

`ToolCardComponent` e `ContextCardComponent` guardam em cache suas linhas renderizadas, indexadas pela largura. O cache é descartado em todo mutador de estado (`updateResult`, `setVisibility`, `setExpanded`) e em `invalidate()` (a cascata do pi-tui pela árvore inteira), então uma mudança de estado sempre renderiza de novo; todo o resto, incluindo cada quadro de tecla, devolve as linhas em cache. Isso restaura a convenção de componentes do próprio pi upstream (componentes filhos persistentes mais `cachedWidth`/`cachedLines` explícitos onde a renderização é customizada, por exemplo `bash.ts` do `coding-agent` do pi), que os corpos imperativos de `render(width)` daqui tinham anulado silenciosamente.

Medido na sessão de 196 mil eventos (tmux, 200×50): prompt pronto na retomada, de 12,2 s para 7,2 s; eco por tecla, de 796 ms de mediana para 17 ms (paridade com uma sessão nova).

## Alternativas consideradas

- **Indexar os offsets de `step/start` e manter o replay por rodapé**: remove o `findIndex`, mas cada rodapé ainda varre o trecho da sua etapa em um array compartilhado; a passagem única e compartilhada do tracker dá o mesmo ganho de complexidade com menos controle a manter.
- **Reestruturar os cartões como componentes filhos persistentes do pi-tui** (o estilo principal do pi upstream): custo equivalente em regime permanente, mas um diff maior no tratamento de estado dos cartões, sem ganho adicional sobre o cache indexado por largura.
- **Fazer cache dentro de `Container.render` do pi-tui**: camada errada. A superfície do patch vendorizado cresceria, e o contrato (os componentes são donos dos seus caches) já existe no upstream.

## Consequências

- A latência de digitação não escala mais com o total de saída de ferramentas; o custo residual por quadro é a travessia da árvore do pi-tui e a concatenação de linhas, linear nas linhas renderizadas. O custo de renderização na retomada agora é dominado pelo layout inicial do pi-tui, feito uma única vez (~4 s com 196 mil eventos), mais o carregamento (~1,7 s), ambos lineares.
- O tracker consome os tempos dos eventos como registrados no log e abandona o corte `time > at` no meio da varredura que a implementação removida fazia, corte que os valores de `at` por rodapé tornam impossível em uma varredura compartilhada; diante de um retrocesso do relógio de parede, cada bucket é limitado a zero, o que pode diferir dos totais do corte antigo.
- O `render()` dos cartões deixa de ser uma função pura de `(state, width)` a cada chamada: os mutadores precisam descartar `linesCache`. Um mutador novo que esqueça de fazer isso mostra linhas desatualizadas; os testes de cache em `packages/ui/tui/tests/transcript-card-cache.spec.ts` fixam o contrato dos mutadores existentes.
- `StepTimingTracker` presume que as coordenadas de etapa não são reutilizadas depois de `step/end`; um `step/start` duplicado para uma etapa fechada é ignorado em vez de reiniciar a etapa.
