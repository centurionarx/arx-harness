# Agent Note: o painel de detalhes da Web começa fechado por padrão

Status: implemented
Archived: 2026-08-07

[English](2026-07-30-web-details-default-closed.md) | Português

## Problema

O store transitório de layout inicializava os detalhes com a largura de contrato de 360px. Por isso, a primeira Session conectada e todo recarregamento completo reservavam uma coluna à direita antes que o usuário selecionasse qualquer conteúdo de detalhe. As linhas de ferramenta do Chat permanecem deliberadamente inline e não abrem os detalhes, enquanto as linhas da Trajectory abrem o painel quando um evento é selecionado, de modo que um layout aberto por padrão não representava uma seleção de detalhe ativa.

## Decisão

O store de layout inicializa os detalhes em zero e mantém o padrão de contrato existente de 360px para `openDetails()`. O `AppFrame` mantém o slot de detalhes montado com largura zero, de modo que um ponto de entrada explícito, como a seleção de evento na Trajectory, consegue abrir o painel sem remontar a subárvore dele. O [ciclo de vida de posse por Session](2026-07-29-web-details-session-lifecycle.md) continua sendo a autoridade: superfícies não selecionadas derivam largura zero sem assumir a posse, voltar à mesma Session preserva uma largura aberta explicitamente, e selecionar uma Session diferente fecha o painel.

A geometria do painel continua transitória. Nenhuma chave de armazenamento do navegador é introduzida, e o recarregamento restaura o padrão da barra lateral enquanto os detalhes voltam a zero. Os testes de componente fixam o padrão do store, o slot montado com largura zero, o comportamento de arrasto e de concessão depois da abertura explícita e as transições de posse por Session. A regressão sem chave da composição distribuída fixa a primeira Session fechada, o recarregamento, a superfície de nova sessão e as seleções de Session subsequentes.

## Alternativas consideradas

**Persistir a última preferência de aberto ou fechado.** Rejeitada porque o recarregamento deve ter uma linha de base fechada e determinística, e persistir a geometria reintroduziria estado de visualização desatualizado entre sessões do navegador.

**Manter os detalhes abertos até que o Chat receba um gesto de seleção substituto.** Rejeitada porque espaço vazio não é conteúdo de detalhe útil. A interação inline das linhas de ferramenta do Chat e qualquer futuro gesto de seleção de detalhe são decisões de produto separadas.

**Remover a coluna de detalhes e o serviço de layout.** Rejeitada porque a Trajectory já abre os detalhes de evento por meio deste seam, e manter o slot montado preserva essa interação que funciona.

## Consequências

Sessions novas, restauradas e recarregadas usam toda a área central até que uma ação explícita de detalhes abra a coluna da direita. A seleção de evento na Trajectory ainda consegue abrir os detalhes em 360px, e o controle de fechar dela devolve a faixa a zero; as linhas de ferramenta do Chat continuam sem efeito sobre a geometria. Trocar para outra Session fecha um painel aberto, e nenhum estado de painel sobrevive ao recarregamento.
