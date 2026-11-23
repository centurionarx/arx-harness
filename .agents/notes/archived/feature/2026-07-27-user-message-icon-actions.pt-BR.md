# Agent Note: IconActions de mensagem do usuário abaixo do balão

Status: implemented
Archived: 2026-07-27

[English](2026-07-27-user-message-icon-actions.md) | Português

## Problema

O balão de usuário do chat não tinha elementos de ação abaixo dele. O design do Harness (figma `User_Bubble/message_container`) mostra três IconActions — copiar, ramificar em um novo chat e editar — alinhadas à direita abaixo do balão, seguindo o padrão de barra de ações do produto usado em outros lugares.

## Decisão

`MessageItem` é dono das ações apenas para `kind: 'user'`. O layout é uma coluna (`align-items: flex-end`, espaçamento de 6px): o balão e, em seguida, uma linha de ações de 28px com espaçamentos de 10px e botões de ícone circulares de 28px (`IconCopyOutline16`, `IconBranchOutline16`, `IconEditOutline16`). Os tooltips trazem rótulos em chinês. As ações ficam visíveis por padrão; `@media (hover: hover)` as esconde até que a linha receba hover ou focus-within, de modo que dispositivos de toque / `hover: none` mantêm controles que podem ser descobertos (a opacidade sozinha ainda responde ao hit-test).

Copiar grava na área de transferência os blocos de texto do balão unidos (`navigator.clipboard.writeText`, com um fallback em `execCommand`). Ramificar e editar são elementos presentes ainda sem handlers — reservam os lugares do design sem inventar um comportamento de fork de sessão ou de edição com reenvio.

Os balões de steering (direcionamento no meio da execução) mantêm a forma só com badge e não mostram essas ações.

## Alternativas consideradas

**Ligar ramificar/editar a um fork real de sessão e a uma edição de rascunho agora.** Rejeitado para esta mudança: esses fluxos de produto não estão especificados; entregar botões inertes corresponde ao escopo pedido e evita caminhos de mutação construídos pela metade.

**Esconder sempre com `opacity: 0` fora do hover.** Rejeitado para toque: sem `@media (hover: hover)`, a opacidade em repouso ainda responde ao hit-test enquanto parece vazia. Ponteiros com capacidade de hover mantêm o fade; os demais mantêm as ações visíveis.

## Consequências

As mensagens do usuário expõem a cópia de imediato; ramificar/editar continuam sendo stubs clicáveis até que uma decisão posterior seja dona do comportamento deles. Os testes fixam os três botões, o conteúdo copiado e a exclusão do steering.
