# Agent Note: Redimensionamento da barra lateral sem pílula visível

Status: implemented
Archived: 2026-08-07

[English](2026-07-30-sidebar-resize-without-visible-pill.md) | Português

## Problema

O AppFrame expunha pílulas flutuantes idênticas nas duas bordas de coluna. A pílula da esquerda acrescentava peso visual desnecessário ao lado da navegação principal, mas a interação de redimensionamento da barra lateral continua útil.

## Decisão

O AppFrame mantém a faixa de 8px que captura o ponteiro para redimensionar a barra lateral, o cursor `col-resize`, a captura de ponteiro, a limitação por quadro de animação e as atualizações de largura, mas não gera o pseudoelemento de pílula do handle da barra lateral. A fronteira do painel de detalhes mantém tanto sua faixa de captura quanto a pílula flutuante.

O teste do componente de layout continua fixando o arrasto da barra lateral e o ciclo de vida de recolhimento dos dois handles. Um cenário de navegador sem chave lê os pseudoelementos gerados a partir da composição distribuída e arrasta a fronteira invisível da barra lateral para provar que a interação continua ativa.

## Alternativas consideradas

**Remover a interação de arrasto da barra lateral junto com a pílula.** Rejeitada porque a mudança pedida é visual; remover um controle de geometria que funciona estreitaria a interação sem necessidade.

**Manter a pílula, mas reduzir sua ênfase.** Uma pílula menor ou de menor contraste ainda deixa um objeto indesejado na fronteira da barra lateral.

## Consequências

A fronteira da barra lateral fica visualmente discreta, enquanto o redimensionamento por ponteiro continua disponível a partir da fronteira e mantém o cursor de redimensionamento. Diferentemente do controle do painel de detalhes, essa interação não tem pílula visível.
