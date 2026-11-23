# Agent Note: comando /details para o estado de detalhe do transcript

Status: implemented
Archived: 2026-08-04

[English](2026-07-30-tui-details-command.md) | Português

## Problema

O estado de detalhe do transcript (registro textual da sessão) da TUI, isto é, a visibilidade dos cartões de ferramenta (`collapsed`/`expanded`/`hidden`, conforme a [apresentação consolidada da TUI](../architecture/2026-07-28-consolidated-tui-presentation.md)) e a exibição dos blocos de raciocínio, só era alcançável pelo ciclo do Ctrl+O e pela alternância do Ctrl+R. Um usuário que quer um modo específico precisa passar pelos outros, não consegue definir as duas dimensões em uma única ação e não tem como consultar o estado atual; um terminal que engole essas teclas de controle não tem alternativa nenhuma.

## Decisão

O `dsh-tui` registra `/details` ao lado dos seus outros comandos com escopo de agent (agente). O `/details` sem argumentos abre o `DetailsDialog`, um seletor de teclado centralizado com uma entrada por dimensão (`Tool cards` e `Reasoning`) que mostra os valores ao vivo: Tab percorre os valores da entrada destacada e aplica a mudança imediatamente, de modo que o transcript atrás do diálogo é a pré-visualização, e Enter, Esc ou Ctrl+C fecha; a largura dele é a chave de configuração `detailsDialogWidth`, e um segundo `/details` substitui um seletor aberto, espelhando a sobreposição de `/model`. Os argumentos nomeiam diretamente os estados de destino: `collapsed|expanded|hidden` leva os cartões de ferramenta para essa fase, `reasoning on|off` define a exibição do raciocínio, `reasoning` sozinho a alterna, e as diretivas se combinam em uma única invocação. Um token desconhecido retorna um erro de comando que carrega a linha de uso. Toda entrada altera o mesmo estado de closure que os atalhos, refatorado de modo que o ciclo e a alternância sejam wrappers finos sobre `setToolsVisibility`/`setReasoning`; os atalhos e os avisos deles ficam inalterados.

Uma invocação combinada aplica o raciocínio antes da visibilidade porque `setReasoning` reconstrói o transcript a partir dos eventos de sessão, o que descarta os componentes de aviso não duráveis; aplicá-lo por último apagaria o aviso de visibilidade recém-acrescentado.

A reconstrução por raciocínio expôs um defeito de replay que esta mudança corrige em `renderEvent`: o caminho ao vivo limpava um `StreamingAssistantComponent` já assentado antes de um `assistant/message` posterior da mesma etapa (assim a segunda mensagem recebia um componente novo), mas o replay de `rebuildTranscript` reutilizava o componente assentado e `settle()` sobrescrevia o conteúdo dele, descartando silenciosamente o texto da mensagem anterior. A verificação de assentado agora fica no caso `assistant/message` de `renderEvent`, um único lugar para os dois caminhos, e o snapshot `untrusted-controls`, antes errado (um cabeçalho `Assistant` vazio onde o raciocínio e o texto haviam sido descartados), foi regravado com o conteúdo presente.

## Alternativas consideradas

**Percorrer o ciclo no `/details` sem argumentos, espelhando o Ctrl+O.** Rejeitada: o valor do comando em relação ao atalho é nomear um estado absoluto; um comando que percorre o ciclo é o atalho com mais teclas, e a invocação sem argumentos é mais útil como o seletor, que mostra o estado atual e oferece todos os destinos.

**`/details` sem argumentos como um relatório de estado somente em texto.** Foi entregue primeiro e substituído pelo seletor: o relatório respondia "where am I", mas ainda exigia uma segunda invocação, com os argumentos escritos por extenso, para mudar qualquer coisa, enquanto o seletor mostra o mesmo estado e aplica uma mudança em uma única interação. A gramática textual permanece para scripts, memória muscular e mudanças combinadas nas duas dimensões.

**Comandos `/tools` e `/reasoning` separados.** Rejeitada: as duas dimensões são uma única preocupação de apresentação ("how much detail does the transcript show"), e um comando único mantém o registry e a lista do `/help` pequenos, além de permitir uma invocação combinada.

**Padrões por modo em chaves de configuração.** Fora do escopo: `showReasoning` já existe como configuração; o comando é estado de runtime por cima dela, em linha com os atalhos.

## Consequências

- Um usuário pode ir direto a qualquer modo de detalhe, definir as duas dimensões de uma vez e ver o estado atual no seletor, inclusive em terminais que interceptam Ctrl+O/Ctrl+R.
- O parser aceita tokens em qualquer ordem, então `/details reasoning expanded` alterna o raciocínio e expande os cartões; a última diretiva vence em cada dimensão. Essa tolerância é deliberada e está documentada no README.
- O seletor não tem estado pendente nem cancelamento: todo Tab é uma mudança real e já notificada, e fechar nunca reverte. Um usuário que passa do ponto simplesmente segue apertando Tab até o valor desejado.
- As reconstruções do transcript não perdem mais mensagens do assistente quando uma etapa carrega mais de um evento `assistant/message`; o snapshot `details-command` fixa a superfície de argumentos e o replay corrigido, e `details-selector` fixa o seletor aberto logo depois de um Tab ter aplicado `hidden` -> `collapsed`, incluindo o cartão de ferramenta restaurado atrás dele.
