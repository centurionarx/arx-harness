# Agent Note: As linhas de raciocínio usam um único alvo de expansão

Status: implemented
Archived: 2026-07-26

[English](2026-07-23-thinking-row-disclosure-target.md) | Português

## Problema

Uma entrada de raciocínio recolhida apresenta `Think` e seu resumo de raciocínio de uma linha como uma única linha visual, mas um controle de expansão formado só pelo ícone deixa os dois rótulos visíveis inertes. Aplicar a expansão pelo título a toda linha de ferramenta, por outro lado, quebraria o contrato genérico da linha de ferramenta, em que a linha abre os detalhes e só o controle inicial expande os argumentos.

## Decisão

O `ToolRow` expõe a política opcional `expandOnRowClick`. O `ThinkRow` a habilita para que o título e o resumo de raciocínio formem um único alvo de expansão acessível; cliques do ponteiro, Enter e Espaço alternam o mesmo estado expandido local do componente. As linhas de ferramenta que não aderem mantêm a seleção de detalhes pela linha e a expansão de argumentos pelo controle inicial.

## Verificação

A spec do componente fixa os dois alvos de clique do Think e a passagem inalterada da linha genérica de ferramenta. A fixture (dados de teste pré-montados) de navegador sem chave carrega os bundles reais da barra lateral e da conversa, abre uma sessão de raciocínio escrita à mão, clica no resumo e no título e verifica o estado de expansão e o corpo expandido.

## Alternativas consideradas

**Expandir toda linha de ferramenta pelo título.** As linhas genéricas de ferramenta usam cliques na linha para a seleção de detalhes, então compartilhar esse comportamento confundiria dois controles.

**Manter a expansão só pelo ícone.** O menor alvo de clique continua desconectado dos rótulos que descrevem o conteúdo oculto.

**Renderizar botões separados para título e resumo.** Dois controles para um único estado expandido acrescentam paradas de foco duplicadas e semântica ambígua.

## Consequências

As linhas de raciocínio ganham um alvo de ponteiro maior e semântica de expansão por teclado sem alterar as demais interações de ferramenta. O componente genérico de linha carrega uma política opcional porque a posse da expansão difere entre raciocínio e chamadas de ferramenta.
