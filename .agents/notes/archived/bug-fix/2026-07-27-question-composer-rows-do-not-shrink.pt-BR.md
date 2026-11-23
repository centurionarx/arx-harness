# Agent Note: As linhas de opção do composer de perguntas são conteúdo de rolagem, não o absorvedor da folga

Status: implemented
Archived: 2026-08-07

[English](2026-07-27-question-composer-rows-do-not-shrink.md) | Português

## Problema

O cartão do composer de perguntas tem a altura limitada em relação à viewport (`max-height: min(60vh, 520px)`) e rola a lista de opções, de modo que o cabeçalho e as ações do rodapé continuam alcançáveis em lotes longos de perguntas. Quando o espaço reservado ao composer ficava baixo (uma janela pequena, ou uma viewport baixa com o painel de detalhes aberto), as linhas de opção eram renderizadas umas sobre as outras e sobre o título da pergunta.

O limite não era o defeito; o defeito era a distribuição do déficit. `.options` é uma caixa `flex-direction: column` cujos filhos têm `flex-shrink: 1` por padrão, então a falta de espaço encolhia primeiro as linhas em vez de transbordar para o contêiner de rolagem. Uma linha encolhia até o `min-height: 42px` enquanto `.optionCopy` mantinha a altura intrínseca maior que o texto quebrado exige (duas linhas para uma opção com descrição). Com `align-items: center`, o texto fica centralizado em uma caixa mais baixa do que ele e é pintado fora da border box da linha nas duas direções: sobre o título acima e sobre a linha seguinte abaixo. Medido no cliente publicado em 900x440: 6,5px de texto fora da caixa da linha, crescendo para 10px com 380px de altura, enquanto `.options` informava `scrollHeight === clientHeight` e, portanto, nunca oferecia uma barra de rolagem.

Só linhas cujo texto quebra conseguem reproduzir o problema. Uma linha cujo texto cabe em uma única linha tem folga entre o conteúdo e o mínimo de 42px, então encolhê-la passa despercebido. É por isso que a fixture (dados de teste pré-montados) de e2e que já existia (opções `Blue`/`Green`, sem descrições) era renderizada corretamente em todos os tamanhos.

## Decisão

`.option` e `.custom` declaram `flex-shrink: 0`.

As linhas são o conteúdo de rolagem de um cartão com altura limitada; o overflow do cartão pertence a `.options`, que já é dono de `overflow-y: auto` e `min-height: 0`. Fixar os filhos faz o déficit chegar a esse contêiner de rolagem em vez de ser absorvido pelas linhas, que é o comportamento para o qual o limite foi projetado. A alternativa, deixar as linhas encolherem mantendo o texto dentro delas, exigiria cortar as descrições das opções ou abreviá-las com reticências exatamente nos tamanhos em que o usuário mais precisa lê-las.

`.header` e `.footer` já carregavam `flex-shrink: 0` pelo mesmo motivo no nível do cartão; os filhos da lista de opções eram a metade que faltava dessa regra.

## Alternativas consideradas

**Cortar o texto ou abreviá-lo com reticências dentro de uma linha encolhida (`overflow: hidden` em `.option`).** Isso remove a sobreposição com uma única declaração e sem repensar o layout. Rejeitada porque troca um defeito visível por um silencioso: a linha mantém os 42px, e a segunda linha da descrição de uma opção simplesmente desaparece exatamente nos tamanhos em que o cartão está mais apertado. A descrição é conteúdo relevante para a decisão, não decoração.

**Trocar `align-items: center` por `align-items: flex-start`.** O texto cresceria apenas para baixo, então deixaria de ser pintado sobre o título acima. Isso não corrige nada: uma linha encolhida continua transbordando sobre a linha de baixo, e a correção mudaria em silêncio o alinhamento vertical de toda linha de opção em todos os tamanhos, inclusive no mais comum.

**Remover o limite `max-height` do cartão para que nada seja espremido.** Sem déficit, não há problema de distribuição. Rejeitada porque é o limite que mantém o cabeçalho e as ações do rodapé na tela em um lote longo de perguntas; removê-lo reintroduz a falha que o limite existe para evitar (o espaço do composer é uma coluna de conversa de altura fixa com `overflow: hidden`, então um cartão sem limite perde o próprio botão de envio).

**Limitar o texto quebrado a uma linha (`white-space: nowrap` mais reticências em `.description`).** As linhas nunca quebrariam, então nunca poderiam transbordar ao encolher. Rejeitada pelo mesmo motivo do corte, e além disso ela degrada a renderização em viewports largas, onde há espaço de sobra, para corrigir um defeito de viewports estreitas.

## Consequências

- Um composer espremido rola a lista de opções em vez de sobrepô-la: em 900x380 a lista informa `scrollHeight` 200 contra `clientHeight` 114 e oferece uma barra de rolagem, onde antes informava os dois como iguais e não oferecia nenhuma.
- As linhas de opção mantêm o texto quebrado completo em todos os tamanhos de viewport. Nada é cortado nem abreviado com reticências, e a renderização em viewports largas não muda (a regra só tem efeito quando a caixa flex recebe menos espaço do que precisa).
- O cartão agora chega mais cedo ao estado de rolagem, já que o déficit não é mais parcialmente absorvido pelas linhas. Esse é o comportamento pretendido do limite, e significa que um espaço baixo mostra uma barra de rolagem em casos que antes mostravam uma lista pintada errado em silêncio.
- A pergunta gravada do cenário é mais longa do que precisaria ser para a ida e volta que ele testa primariamente. Esse custo é deliberado: a invariante de layout não é falseável sem texto que quebre, e uma segunda fixture para uma única regra de CSS seria pior.

## Verificação

O cenário de composer do e2e da web verifica a invariante no composer vivo em três alturas espremidas do espaço (900x520 / 440 / 380): os filhos de toda linha de opção ficam dentro da border box da linha. Duas proteções impedem que a asserção valha por vacuidade: pelo menos uma linha precisa estar quebrada (a única forma que transborda) e `.options` precisa estar de fato rolando (prova de que o espaço está realmente limitado). A pergunta gravada do cenário agora carrega descrições longas de opção exatamente por esse motivo; sem texto que quebre, a asserção não tem como falhar.

Confirmado nas duas direções contra o cliente compilado: com `flex-shrink: 0` revertido, o cenário falha (`scrolls: false`, 6,5px de vazamento), e com ele restaurado, passa. Uma varredura de geometria independente sobre 340 tamanhos de viewport (420-1600 x 320-960) foi de 86 tamanhos com texto fora da caixa de uma linha para zero.

A asserção vale apenas no replay: o modo de gravação precisa chegar à escrita da fixture em vez de abortar por causa do layout. Note que o composer é distribuído como um bundle de módulo de cliente, então `pnpm run build:web` sozinho não incorpora uma mudança em `QuestionComposer.module.css`; o build do pacote precisa rodar para que a trilha de browser a enxergue.

Reproduzir o déficit exige uma viewport baixa, não um contêiner baixo. O limite é `min(60vh, 520px)`, então encolher a coluna de conversa abaixo da altura do próprio cartão corta o cartão sem deixá-lo com menos espaço do que precisa: as linhas mantêm a altura completa e nada vaza. Qualquer coisa que demonstre ou meça esse defeito fora do cenário de e2e precisa mudar a viewport.

Um `lib/` desatualizado faz a trilha de browser verificar um cliente mais antigo do que a árvore, e um `pnpm run build` que falha no meio do caminho deixa exatamente isso: os pacotes compilados antes da falha estão atuais, os demais não. Atualizar uma saída esperada nesse estado grava a superfície do cliente mais antigo. Confirme que o build terminou com código zero antes de capturar, e note que diretórios não rastreados em `packages/` também são compilados: uma sobra de outro branch pode fazer o build falhar por motivos que o diff não explica.
