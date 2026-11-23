# Agent Note: Os hover cards copiam seu valor principal na ativação

Status: implemented
Archived: 2026-08-07

[English](2026-07-31-hover-card-click-copy.md) | Português

## Problema

As linhas de Workspace e de Session cortam os dois valores que seus hover cards expõem por inteiro: o caminho do diretório do Workspace e o título da Session. O [cartão alcançável](../bug-fix/2026-07-30-hover-popup-pointer-grace.md) permite selecionar texto, mas selecionar e copiar um único valor conhecido é um gesto preciso sem necessidade, e o cartão não dá nenhuma confirmação de que a área de transferência aceitou o valor.

## Decisão

`HoverCard` aceita um `copyText` opcional, além de `copyLabel` e `copiedLabel`. Com `copyText`, o cartão inteiro tem semântica de botão para ativação por ponteiro e por teclado; seu nome acessível combina o prefixo de ação localizado com o valor exato, ele grava esse valor por meio do helper compartilhado de área de transferência e substitui seu conteúdo pelo rótulo de sucesso por até um segundo, somente depois que o host aceita a gravação. O feedback mantém a altura que o cartão tinha antes da cópia e é limpo junto com o cartão. Sem `copyText`, o átomo mantém seu comportamento apenas de leitura/seleção.

O navegador de Workspace escolhe o conteúdo a copiar, em vez de fazer a primitiva inferi-lo a partir do texto renderizado: um cartão de Workspace passa o caminho completo do diretório, e um cartão de Session que não esteja em branco passa o título de exibição completo. Um cartão provisório de New Session em branco continua somente leitura, porque seu rótulo localizado é um placeholder, não conteúdo de sessão. O lugar de locale do navegador fornece `Copy`/`Copiar` e o estado de sucesso `Copied`/`Copiado`.

Pressionar e ativar continuam sendo contratos separados. Um pressionamento de ponteiro dentro do cartão o mantém montado para que a seleção de texto possa começar; uma seleção concluída e não colapsada que intersecta o cartão suprime a ativação por clique de ponteiro, enquanto um clique simples ou uma tecla de botão ativa a cópia. Pressionamentos na região da âncora ainda dispensam o cartão imediatamente, e a rejeição pela área de transferência deixa o conteúdo original visível, sem alegar sucesso.

## Alternativas consideradas

**Copiar o `textContent` renderizado do cartão.** Isso concatenaria o valor principal com a hora de criação ou com o status de execução, fazendo o conteúdo da área de transferência depender da apresentação e da localização.

**Implementar o estado de área de transferência nos dois corpos de cartão do Workspace.** Os dois consumidores duplicariam o fallback de host, o comportamento de teclado, a posse do timer e a renderização de sucesso, embora o cartão seja dono da superfície de ativação.

**Mudar o rótulo comum `copied` da redação mais longa, "cópia concluída", para a mais curta, "copiado".** Isso alteraria todos os controles de cópia existentes para atender a uma única interação de cartão. Em vez disso, o dicionário do Workspace é dono da redação específica do cartão.

## Consequências

As duas variantes de hover card que não são placeholder ganham a mesma affordance de clique e de teclado, mantendo a semântica de conteúdo definida pelo consumidor e o feedback localizado. O átomo genérico acrescenta um caminho de comportamento opcional e um timer de um segundo; ele limpa o estado de copiado ao fechar, ignora a conclusão depois do fechamento ou da desmontagem e nunca informa como sucesso uma gravação rejeitada. A cobertura focada de componente fixa a precedência da seleção por ponteiro, a ativação, a falha, a geometria e a expiração do feedback e a limpeza, enquanto o cenário de Workspace em navegador real verifica o rótulo em inglês, a altura estável do feedback e a área de transferência do navegador.
