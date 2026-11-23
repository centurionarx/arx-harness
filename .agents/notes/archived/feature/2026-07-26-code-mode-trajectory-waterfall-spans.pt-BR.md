# Agent Note: Subchamadas do Code Mode nas visões de trajetória e waterfall

Status: implemented
Archived: 2026-07-28

[English](2026-07-26-code-mode-trajectory-waterfall-spans.md) | Português

> Escopo: o PR (Pull Request) final da pilha de UI do Code Mode, com a renderização de subdispatches nas duas visões que não são o chat. O aninhamento no chat pertence à [nota das linhas de subchamada](2026-07-26-code-mode-chat-subcall-rows.md); o tempo consumido aqui é o par start/settle da [nota de paralelismo ao vivo](2026-07-26-code-mode-live-parallel-dispatch.md).

## Problema

A trajetória e o waterfall ainda renderizavam um turno de `run_code` como uma célula Tool opaca / uma barra de contagem de nós. A visão de chat ganhou sublinhas aninhadas nos PRs anteriores, mas as duas visões analíticas, cujo propósito inteiro é estrutura e tempo, não mostravam nada da estrutura de subchamadas nem do tempo de relógio por subchamada que o par de dispatch agora registra. Os subspans do waterfall foram adiados deliberadamente até que esse par existisse: um span sem tempo real teria sido uma mentira.

## Decisão

**Trajetória: células `subtool` intercaladas depois da célula Tool pai. Waterfall: subfaixas de tempo real sob a linha do turno dono.**

- **Trajetória**: o fold de layout recebe o índice `codeDispatches` do snapshot; depois de cada célula Tool cujo `callId` tem dispatches (chamadas de bloco do assistente, resultados órfãos e chamadas em execução, sem distinção), ele intercala uma célula `subtool` por subdispatch, na ordem de início, e os índices continuam sequenciais ao longo da intercalação. A duração de uma subchamada concluída é o par start/settle dela (`durationSeconds(sub.time, sub.callTime)`); uma em execução mostra o travessão, exatamente a convenção nativa para chamadas em andamento. O novo tipo de célula recebe uma tag `Sub` (tom business) e um recuo de 28px para que o aninhamento seja lido de relance.
- **Waterfall**: `deriveSubSpans` converte o índice de dispatches em faixas por turno com tempo REAL: a janela de dispatch de cada pai vai do primeiro start ao último settle, e o offset/largura de cada faixa é a fração dela nessa janela, então subchamadas paralelas (PR3) se sobrepõem visivelmente. Cada faixa carrega uma tag de proveniência `timing`: `measured` (par observado), `running` (settle pendente; estende-se até o fim da janela com opacidade reduzida) ou `unknown` (janela de replay só com settle, `callTime: null`; desenhada vazada e com o título "duration unknown", nunca um 0 ms fabricado). As faixas são desenhadas sob a linha de barra do turno dono, escaladas para um orçamento fixo de faixas.
- As duas visões leem `codeDispatches` pelo hook padrão de snapshot: nenhum dado novo no wire, nenhum store novo; o replay renderiza de forma idêntica ao ao vivo por construção.

## Alternativas consideradas

**Incorporar as subchamadas às contagens de nós do span do turno (ponderar as barras existentes).** Rejeitada: isso esconde exatamente a estrutura que esta pilha existe para mostrar, e a ponderação por contagem de nós já está sinalizada como um substituto provisório (item nº 3 do registro de desvios).

**Um painel dedicado de subchamadas em vez do aninhamento dentro da visão.** Rejeitada: a UX consolidada da pilha é o aninhamento sob o pai em todo lugar; um painel separado divergiria do chat e duplicaria o encanamento de seleção.

**Adiar as faixas do waterfall até o redesenho de faixas de duração da P-III.** Rejeitada: o tempo das subfaixas é real hoje (o par), e a renderização por fração da janela independe do que as faixas no nível do turno venham a ser; adiar deixaria encalhado o retorno de tempo da pilha.

## Consequências

O waterfall carrega a primeira renderização de tempo de relógio REAL do cliente (as barras de turno continuam sendo substitutos provisórios por contagem de nós; o contraste é deliberado e rotulado pelos títulos de hover). Os índices de célula da trajetória agora contam subchamadas, então os totais `#N` crescem em turnos do Code Mode. As specs fixam a ordem de intercalação e as durações, o ramo do travessão para chamadas em execução, as frações da janela (offsets/larguras), a extensão da faixa em execução, a faixa de tempo desconhecido (só settle) e a faixa renderizada sob a linha do turno; o snapshot da fixture (dados de teste pré-montados) do Code Mode com o cliente compilado fixa, além disso, a renderização montada das duas abas (subcélulas com durações reais de +0.8s, faixas medidas).
