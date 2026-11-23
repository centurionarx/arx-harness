# Agent Note: Renderização de Markdown no cartão genérico da TUI

Status: implemented
Archived: 2026-08-04

[English](2026-07-23-tui-generic-card-markdown.md) | Português

## Problema

Os presenters de ferramenta podem colocar Markdown no conteúdo do cartão genérico, inclusive a saída `console` em bloco cercado usada para confirmações de tarefas em segundo plano e para erros de execução. Renderizar esse conteúdo como texto simples expõe os marcadores de cerca e diverge do conteúdo do assistente e do usuário no mesmo transcript (registro textual da sessão).

## Decisão

A TUI renderiza o conteúdo de resultado do cartão genérico com o tema Markdown compartilhado antes de aplicar o limite de linhas de início e fim do cartão. Os cartões de terminal e de diff mantêm seus renderizadores especializados de texto simples, e a entrada bruta do cartão genérico continua literal, porque representa argumentos da ferramenta, e não prosa escrita pelo presenter.

O tema compartilhado oculta a sintaxe de cerca, mantém o rótulo de linguagem opcional e colore o corpo cercado como código. A renderização vem antes do truncamento, para que as contagens de linhas e os limites do cartão recolhido descrevam as linhas visíveis do terminal, e não as linhas do Markdown de origem.

## Alternativas consideradas

**Remover as cercas no presenter do Bash.** Isso corrigiria um único produtor, deixaria sem renderização o Markdown de cartão genérico vindo de outras ferramentas e faria o presenter depender do comportamento da TUI.

**Renderizar todo cartão de ferramenta como Markdown.** A saída de terminal e os diffs têm formatação dedicada e podem conter pontuação de Markdown que precisa continuar literal.

**Aplicar o limite do cartão recolhido antes da renderização de Markdown.** O truncamento por linhas de origem pode partir um bloco cercado e faz a contagem de linhas visíveis diferir da contagem usada pelo cartão.

## Consequências

Os cartões genéricos de ferramenta usam o mesmo vocabulário de Markdown e o mesmo caminho de sanitização do conteúdo da conversa. A pontuação de Markdown em um cartão genérico é interpretada, em vez de ser sempre exibida literalmente; ferramentas que exigem saída de terminal literal usam a intenção de cartão de terminal.

O teste focado da TUI fixa as cercas ocultas, os rótulos de linguagem mantidos e o texto do corpo. O snapshot de estado do terminal, que roda sem chave, cobre o comportamento por meio de um transcript montado da TUI.
