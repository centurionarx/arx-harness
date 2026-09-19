# Agent Note: Navegar pela sessão completa por turno

Status: implemented

[English](2026-09-12-whole-session-turn-outline.md) | Português

## Problema

O histórico paginado da conversa não oferece um índice das solicitações antigas, e enviar o índice completo a cada atualização faria as mensagens e a renderização no navegador crescerem sem limite.

## Decisão

A [projeção opcional de turnos](../../../../packages/session/session-turn-outline/README.md) indexa limites duráveis de turnos e o primeiro texto direto não vazio do usuário. Sua acumulação no host independe do histórico paginado do navegador e do contexto compactado do modelo. Blocos imutáveis de até 256 entradas limitam o trabalho de cópia de cada atualização; estados e páginas já publicados mantêm suas identidades e seus conteúdos. Forks mantêm entradas herdadas e acrescentam seus próprios turnos. O registro de projeções valida e distribui o índice sem criar nova entrada para o modelo.

A [visualização opcional do índice](../../../../packages/client/ui-turn-outline/README.md) consome o hook padrão de projeção. O proprietário da visualização da conversa fornece callbacks de abertura limitada e cancelamento; o índice não importa componentes de Chat nem inspeciona o DOM de outro plugin. O proprietário resolve um limite exato de turno e uma linha visível pelo índice de localização existente, paginando em série com teto de 20 páginas e recusando ausência de avanço. Seu armazenamento de estado de visualização por sessão leva o alvo de linha de uso único. Chat é responsável pela rolagem e confirmação.

## Consequências

Usuários podem localizar uma solicitação antiga sem carregar manualmente todas as páginas do histórico antes. O cancelamento da navegação invalida a abertura pendente; não aborta uma requisição de histórico que já pertence ao runtime. Histórico ausente, sessões alteradas e turnos sem texto e sem linhas visíveis produzem uma recusa em vez de abrir um turno vizinho.

Testes de composição com Loader e de replay e fork fixam coordenadas do log completo e ausência de mutação no log. Testes de componentes fixam busca no índice completo, falha de navegação, cancelamento ao desmontar, rolagem para a linha exata, limpeza do alvo e posição ao remontar. O índice no host mantém uma entrada por turno e um trecho de 120 pontos de código. Atualizações da projeção e respostas de busca autenticada transportam no máximo 100 turnos; a UI substitui páginas em vez de ampliar uma lista sem limite.

## Alternativas consideradas

Truncar o índice no host eliminaria o acesso aos primeiros turnos. Uma projeção ilimitada no navegador ou uma lista virtualizada ainda transportaria o índice inteiro. Páginas limitadas preservam o histórico completo e limitam cada resposta e lista renderizada.
