# Agent Note: Slogans de inicialização substituem a linha de boas-vindas configurada da TUI

Status: implemented
Archived: 2026-07-26

[English](2026-07-20-tui-startup-slogans.md) | Português

> **Substituída** na metade de slogan/animação pela [Agent Note da varredura do banner](2026-07-21-tui-banner-sweep.md): o banco de slogans e a revelação em estilo máquina de escrever foram lançados, pareceram estranhos no uso e foram trocados por um banner sem subtítulo com uma varredura do banner inteiro. A remoção da mensagem de boas-vindas configurada do demo e a base do ciclo de vida da animação (iniciar depois de `ui.start()`, limpar por `detachListeners`) continuam valendo.

## Problema

O subtítulo do cabeçalho da TUI vinha de uma configuração `welcome` que a folha do demo definia como "TUI agent ready. Give it a coding task." — um enchimento instrucional que não dizia nada a um usuário que voltava, repetia o que o produto é a cada inicialização e tinha um gêmeo fixo no código (`'ready.'`) como valor padrão do schema em dois pacotes. O produto queria um momento de inicialização com alguma personalidade no lugar de uma legenda estática de banner.

## Decisão

- `examples/tui-agent/cordis.yml` não configura mais `welcome`; a chave de configuração permanece para implantações e fixtures que precisam de um subtítulo fixo e determinístico (o overlay do Code Mode e todo fixture de snapshot ou roteirizado mantêm o seu).
- Quando `welcome` não está definido, `dsh-tui` escolhe um membro de um banco exportado `STARTUP_SLOGANS` por inicialização (`pickStartupSlogan`, com fonte aleatória injetável) e o revela com uma animação de máquina de escrever: um caractere por quadro de 40 ms, com um cursor de bloco `▌` no fim até completar. A revelação só começa depois que `ui.start()` tem sucesso, e o intervalo dela é limpo no dispose junto com os outros listeners.
- O banco de slogans é texto de apresentação, deliberadamente fora da configuração: implantações que querem uma redação controlada já têm `welcome`. Os slogans são somente ASCII por contrato, porque a revelação fatia por caractere.
- `dsh-tui-demo` repassa `welcome` apenas quando configurado, em vez de atribuir um valor padrão, de modo que a aplicação não decide mais o subtítulo ocioso da TUI.
- O cenário de inicialização em PTY sem chave agora espera o cursor da revelação (`▌` — a única origem desse glifo em um transcript vazio) em vez do texto de boas-vindas removido.

A mesma mudança devolve `packages/ui/tui/src/index.ts` a 100 % de cobertura por arquivo, que o merge do esquema de cores tinha quebrado no branch de integração: a reatribuição da cor da borda do editor dentro de `applyColorScheme` era código morto (a chamada a `setStatus` logo em seguida a deriva de novo) e foi removida, e as arrow functions `.then`/`.catch` da consulta de esquema de cores viraram handlers nomeados e testados (`applyReportedScheme`, `ignoreSchemeQueryFailure` — este último fixado por um teste cujo terminal lança erro na escrita da consulta DSR).

## Alternativas consideradas

**Um slogan fixo mais interessante.** Rejeitado: uma única string relida a cada inicialização vira papel de parede exatamente como a linha que ela substitui; um pequeno banco rotativo mantém o momento vivo sem custo de complexidade.

**Tornar configuráveis o banco e a velocidade da revelação.** Rejeitado: seriam dois ajustes novos para texto de apresentação; `welcome` já é a saída para implantações que têm opinião, e a regra contra ajustes fixos no código mira comportamento que varia por implantação, não texto de marca.

**Animar no próprio `HeaderComponent`.** Rejeitado: o componente precisaria de um handle da TUI e de um ciclo de vida próprio; o chat já é dono de um loop de renderização, de timers e de um caminho de liberação, então a revelação fica ao lado dos outros efeitos de `createTuiChat` e `detachListeners` a limpa.

## Consequências

- A saída de inicialização deixa de ser determinística byte a byte quando `welcome` não está definido (slogan aleatório, quadros temporizados). Toda superfície gravada ou de snapshot fixa `welcome` explicitamente, então nenhum snapshot mudou; o teste de fumaça em PTY se ancora no cursor da revelação e na linha do id da sessão.
- O valor padrão de `welcome` no schema desapareceu tanto de `dsh-tui` quanto de `dsh-tui-demo`; quem chama diretamente sem passar welcome agora recebe um slogan, não `'ready.'`.
- Acrescentar um slogan é uma edição de uma linha no banco; os testes verificam a pertinência ao banco, não um texto específico.

## Testes

`packages/ui/tui/tests/tui.spec.ts` fixa a seleção determinística no banco com uma fonte aleatória injetada, a revelação (um membro do banco renderizado por inteiro, quadros de cursor observados), o caminho de welcome configurado renderizando literalmente e sem cursor, e o dispose interrompendo uma animação no meio da revelação. `examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` inicializa a árvore real em um PTY e espera o cursor da revelação. Verificado ao vivo no tmux (quadro no meio da revelação `no map below▌` e depois o slogan completo).
