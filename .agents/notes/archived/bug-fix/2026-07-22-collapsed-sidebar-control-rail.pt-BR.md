# Agent Note: A barra lateral recolhida mantém seu trilho de controles

Status: implemented
Archived: 2026-07-26

[English](2026-07-22-collapsed-sidebar-control-rail.md) | Português

## Problema

A ação de fechar a barra lateral persistia uma preferência de largura zero, e o layout mapeava essa preferência para uma trilha de grid de largura zero. O único botão de alternância da barra lateral e a entrada de configurações ficavam ambos dentro dessa trilha recortada, então fechar a barra lateral removia todo controle visível de recuperação. Recarregar a página preservava a preferência de fechamento e reproduzia o bloqueio.

## Decisão

O layout mapeia uma barra lateral fechada (largura persistida `0`) para a largura fixa `SIDEBAR_COLLAPSED` de 56px: uma coluna de ícones de 24px entre os paddings horizontais de 16px da barra lateral. A trilha da barra lateral tem largura fixa no solver: aberta ou recolhida, ela nunca cede à pressão do viewport (só o painel de detalhes encolhe e depois se fecha automaticamente), e o trilho de controles (control rail) mantém sua borda direita enquanto a largura expandida armazenada permanece intocada.

O `AppFrame` marca a barra lateral como recolhida a partir da preferência de largura persistida, e não da largura resolvida da trilha, remove a alça de redimensionamento enquanto ela está recolhida e passa `collapsed` ao slot da barra lateral como props do dono a partir do ponto de renderização. Recolher e expandir são animados: o frame faz a transição de `grid-template-columns` (e a alça restante, a de seu `left`) na curva do sider do deepsuite, `--ds-ease-in-out` ao longo de `--ds-transition-duration-slow`, ambas fornecidas pela folha de estilo base do ui-theme; as transições pausam durante arrastes e sob `prefers-reduced-motion`.

O `SidebarRoot` lê a prop `collapsed` do dono e faz a transição como deslizamento + crossfade: o conteúdo expandido congela em sua largura (estilo inline) e some no lugar ao longo de 150ms enquanto a coluna deslizante do grid o recorta, e nada sofre reflow no meio do deslizamento. Ao assentar, o conteúdo exclusivo do modo largo (marca, rótulos, campo de entrada, árvore de sessões) é desmontado, o que encerra a assinatura de sessões e o retira das árvores renderizada e de acessibilidade, e as linhas de controle se encaixam no trilho (botão de abrir, nova sessão, novo workspace, busca, na mesma ordem de cima para baixo de suas linhas expandidas), surgindo em fade quando o deslizamento termina. Cada controle do trilho mantém o comportamento de seu equivalente expandido (o ícone de busca expande a barra lateral e foca a caixa de busca depois do deslizamento), carrega uma tooltip, e o botão de alternância repousa como a marca da baleia, com o ícone de painel ao passar o mouse. A consulta de busca vive na raiz e sobrevive à ida e volta.

## Alternativas consideradas

- **Renderizar um botão de expandir sobre a coluna central**: rejeitada porque recupera apenas o botão de alternância, não a área persistente de configurações, e divide o chrome da barra lateral entre dois pacotes donos.
- **Manter uma trilha de grid de largura zero e deixar o trilho transbordá-la**: rejeitada porque o trilho se sobreporia à coluna central e deixaria o hit testing e a geometria responsiva desconectados do grid.
- **Manter a árvore completa da barra lateral montada e ocultá-la com recorte**: rejeitada porque os controles ocultos permanecem na árvore semântica e continuam assinando e renderizando, embora só dois controles pertençam ao estado recolhido.

## Consequências

- Uma barra lateral recolhida reserva 56px em vez de ceder toda a largura à coluna central. Expandir restaura a largura persistida e o comportamento de arraste.
- A entrada de configurações permanece visível, mas mantém seu comportamento atual de placeholder; esta mudança não introduz uma tela de conta nem de configurações.
- Os testes do solver de layout fixam a largura compacta, os testes de componente da barra lateral fixam os controles visíveis, e o teste de fumaça web sem chave, com o bundle real, fixa o recolhimento e a recuperação por meio do cliente montado.
