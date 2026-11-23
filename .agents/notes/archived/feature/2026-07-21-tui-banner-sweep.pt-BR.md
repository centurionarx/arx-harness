# Agent Note: O banner entra com uma varredura; a linha de subtítulo deixa de existir

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-banner-sweep.md) | Português

> **Substituída** pela [Agent Note sem banner](2026-07-21-tui-no-banner.md): o próprio banner foi removido, e a varredura foi junto.

## Problema

A [Agent Note dos slogans de inicialização](2026-07-20-tui-startup-slogans.md) substituiu a linha instrucional de boas-vindas por um banco de slogans aleatórios, revelados por um efeito de máquina de escrever, caractere a caractere. No uso, as citações soavam estranhas (texto decorativo aleatório no cabeçalho de uma ferramenta), e a animação era lenta (40 ms/caractere ao longo de uma frase inteira), além de animar apenas uma linha de um banner de quatro linhas. Esta nota substitui a metade daquela decisão que trata dos slogans; a remoção das boas-vindas configuradas da demo e a base do ciclo de vida da animação continuam valendo.

## Decisão

- O banco de slogans, `pickStartupSlogan` e a revelação em máquina de escrever são excluídos. Quando `welcome` não está definido, o banner simplesmente **não tem linha de subtítulo**: apenas o título e o detalhe de modelo/sessão. A configuração `welcome` permanece para deploys e fixtures (dados de teste pré-montados) que queiram um subtítulo fixo, renderizado de forma determinística quadro a quadro, sem animação.
- A animação de inicialização agora é o **banner inteiro**: `HeaderComponent` ganha um recorte `revealWidth`, e a caixa do cabeçalho surge da esquerda para a direita ao longo de ~24 quadros a 15 ms (~360 ms no total, ~60 fps), iniciada depois que `ui.start()` tem sucesso e encerrada pelo mesmo caminho `detachListeners` que a máquina de escrever usava. `stopBannerReveal` também redefine o recorte, para que um cabeçalho liberado no meio da varredura seja renderizado de novo por inteiro.
- O marcador de inicialização do teste de fumaça em PTY muda do cursor da máquina de escrever (`▌`) para o canto superior direito do banner (`╮`), que só é renderizado quando a varredura termina.

## Alternativas consideradas

**Manter a animação como está e mudar apenas o texto.** Rejeitada: qualquer frase fixa ou rotativa relida a cada inicialização vira papel de parede; a avaliação do usuário foi que as próprias citações, e não só o conteúdo delas, eram inadequadas para a superfície.

**Animar por linha do banner (de cima para baixo) em vez de uma varredura da esquerda para a direita.** Rejeitada: com apenas quatro linhas, a animação teria quatro passos visíveis, mais perto de uma piscada do que de uma revelação; a varredura horizontal usa toda a largura do terminal para um movimento suave com a mesma duração total.

**Recorte no nível de caractere via `revealWidth` em texto estilizado.** Adotada com `truncateToWidth` do pi-tui, o mesmo recortador ciente de ANSI que o cabeçalho já usa para o excesso de largura, de modo que a varredura não consegue partir sequências de escape.

## Consequências

- A saída de inicialização com `welcome` não definido volta a depender de animação, mas deixa de ser aleatória: toda inicialização varre o mesmo banner. As boas-vindas configuradas (todas as fixtures de snapshot/roteirizadas, o overlay do Code Mode) continuam determinísticas quadro a quadro e inalteradas.
- Os exports `STARTUP_SLOGANS`/`pickStartupSlogan` deixaram de existir; nenhum consumidor fora dos testes excluídos os referenciava.
- O banner padrão tem uma linha a menos (sem subtítulo), então as asserções em PTY ancoradas na geometria do banner usam o glifo do canto, e não algum texto de subtítulo.

## Testes

`packages/ui/tui/tests/tui.spec.ts` fixa: a varredura termina em um banner completo (os dois cantos + o título) e produziu pelo menos um quadro recortado no meio da varredura; boas-vindas configuradas são renderizadas literalmente, sem quadros recortados; o banner sem welcome definido não tem subtítulo; e o dispose encerra o handle de intervalo da própria varredura. O teste de fumaça em PTY inicializa com o marcador de conclusão `╮` no bin tui-demo, na CLI dsh e nos cenários de overlay pessoal. Verificado ao vivo no tmux.
