# Agent Note: Detalhamento das estatísticas do composer Web e acabamento da zona de entrada

Status: implemented
Archived: 2026-08-07

[English](2026-07-30-web-composer-stats-and-input-polish.md) | Português

## Problema

O rodapé do composer Web mostrava uma única string de estatísticas concatenada (cache/tokens/turnos/etapas) em uma linha própria da pilha, visualmente descolada do cartão de entrada e sem os detalhes de duração e de divisão de tokens previstos no design. A própria zona de entrada tinha acumulado gambiarras de espaçamento por entrada: as faixas do dock carregavam margens próprias, o assento sticky ficava sobre um preenchimento sólido que cortava o transcript (registro textual da sessão) de forma abrupta, o controle de voltar ao fim se afastava do composer por um offset fixo no código que quebrava conforme o rascunho crescia, e as faixas de goal e de todo divergiam na cor da superfície e na largura da coluna.

## Decisão

**A linha de estatísticas é renderizada dentro da coluna de largura do InputBar por meio de uma nova prop de dono, `footer`, e se expande para a linha de detalhes agrupados do design; a pilha do composer é dona de um único ritmo de 6px; o assento esmaece o transcript por um gradiente fixo de 36px vinculado a tokens; o controle de voltar ao fim acompanha um `--dsh-composer-height` atualizado ao vivo; goal, todo e fila compartilham uma única coluna de 752px com preenchimento tip.**

- As entradas de `'conversation.composer.dock'` chegam à página como o slot `ComposerBarOwnerProps.footer`, renderizado abaixo do cartão dentro do `.root` da barra, de modo que a linha de estatísticas e o cartão compartilham uma única restrição de largura. `StatsLine` deriva tudo no lado do cliente a partir do snapshot: turnos/etapas, tempo de parede do LLM (modelo de linguagem de grande porte) a partir do `timing` do assistente (`completedTime - stepStartTime`), tempo de parede das ferramentas a partir dos pares `time - callTime` dos resultados de ferramenta, divisão de tokens entre prompt e saída com a leitura de cache incorporada à entrada, e percentual de acerto de cache. Os grupos são renderizados separados por barras verticais e somem inteiros quando vazios; `formatTokens` (517 / 12.2K / 1.2M) e `formatDuration` (45.2s / 2m42s) são exportados para os testes. As durações cobrem apenas os nós dentro da janela: o README é dono dessa limitação.
- `.composerStack` carrega o espaçamento de 6px da matriz de composição do Figma. Goal e Todo continuam sendo cartões avulsos; a entrada terminal Queue subtrai esse espaçamento mais a sobreposição de layout nomeada de 5px, para que o cartão do composer, que vem depois, pinte apenas sobre a borda da fila. A [decisão sobre a pilha de contexto do composer](../bug-fix/2026-07-30-composer-context-stack-order.md) é dona do contrato de ordem e de sobreposição.
- O fundo do assento sticky é um `linear-gradient` que vai de `color-mix(bg-base 0%, transparent)` em 0px até `bg-base` sólido em 36px: paradas em pixels, não a porcentagem da exportação do figma, de modo que um rascunho que cresce alarga apenas a região sólida; `color-mix` mantém os dois temas esmaecendo a partir da própria base.
- Uma ref de `useCallback` no assento anexa um ResizeObserver que publica `--dsh-composer-height` no corpo de rolagem; o slot de voltar ao fim do ChatView calcula `bottom` a partir dele (com fallback de 152px na primeira pintura) em vez dos 168px fixos no código de antes.
- O piso de 52px, equivalente a duas linhas, do textarea vale apenas para a variante hero; o composer acoplado colapsa para a altura do conteúdo. Os painéis Goal, Todo e Queue usam a coluna com calha de 44px e teto de 752px, com preenchimento `tip` e borda l1; os cartões avulsos de Goal e de Todo recolhido têm 36px e 44px de altura.

## Alternativas consideradas

**Paradas de gradiente em porcentagem (os 24% da exportação do figma).** Rejeitada: a parada escala com a altura do assento, então um rascunho alto estica a faixa de esmaecimento sobre a maior parte do transcript; a faixa fixa de 36px equivale aos 24% do design com o composer em repouso, de ~150px, e permanece constante conforme o composer cresce.

**Um contrato genérico de "a entrada mais abaixo se encaixa".** Rejeitada porque Goal e Todo são cartões independentes mesmo quando um deles é a última entrada visível do dock. Queue é dona da única sobreposição intencional com o composer, enquanto a pilha é dona dos seus valores compartilhados de espaçamento e de sobreposição.

**Campos de duração fornecidos pelo backend para a linha de estatísticas.** Desnecessária: o `timing` do assistente e os pares de chamada/resultado de ferramenta já chegam ao snapshot, então os tempos de parede são calculados no lado do cliente, sem nenhum novo evento de sessão nem projeção no host.

**Manter a linha de estatísticas como irmã na pilha do composer.** Rejeitada: como linha da pilha, ela carregava uma restrição de largura própria que se desalinhava da do cartão; como `footer` da barra, as duas compartilham uma única coluna e as estatísticas participam da região sticky/gradiente do assento por construção.

## Consequências

A linha de estatísticas mostra de relance turnos/etapas, durações de LLM e de ferramentas, acerto de cache e tokens de entrada/saída, ao custo de as durações cobrirem apenas a janela de eventos carregada (Known Limitation do README). A ordem fixa da pilha mantém independentes os cartões de contexto avulsos e faz de Queue o único painel unido ao composer; uma futura entrada do dock precisa escolher sua ordem em relação a esses papéis. A faixa de esmaecimento tem 36px constantes, então qualquer reajuste futuro do design é o valor de uma única parada. `chat-stats-bash-sample.spec.tsx` fixa a derivação (incorporação de timing/ferramentas, divisão de tokens), os dois formatadores, a renderização agrupada e a aceitação de zero renderizações durante o streaming.
