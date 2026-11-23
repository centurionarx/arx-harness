# Agent Note: Remover o comando de barra `/cancel` da TUI

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-remove-cancel-command.md) | Português

## Problema

A TUI expunha duas formas idênticas de cancelar um turno em execução: o atalho de teclado `Esc` (e `Ctrl+C`) e um comando de barra `/cancel`. As duas chamavam `agent.cancel('cancelled from terminal')` com o mesmo motivo; em estado ocioso, `/cancel` apenas imprimia um aviso "The agent is already idle.", enquanto os atalhos ficavam em silêncio. A linha de status durante a execução já anuncia o atalho (`Enter sends steering, Esc cancels`), e cancelar por tecla não exige submeter nada pelo editor, então o comando de barra era um segundo caminho, menos fácil de descobrir, para o mesmo efeito: área de superfície sem comportamento próprio.

## Decisão

`/cancel` foi removido. Cancelar um turno em execução é um recurso de interação exclusivo de atalho de teclado (`Esc`, ou `Ctrl+C` durante a execução), que a dica da linha de status e a lista de atalhos do `/help` já documentam. A entrada de autocompletar em `baseCommands`, a linha do comando no `/help`, o ramo `case '/cancel'` no handler de submissão do editor e o aviso de "already idle" que pertencia a ele deixaram de existir; todos os outros comandos de barra (`/help`, `/clear`, `/reasoning`, `/tools`, `/redraw`, `/reload`, `/resume`, `/exit`, `/skill:<name>`) ficam inalterados. Digitar `/cancel` agora recai no aviso genérico `Unknown command:`, como qualquer outra entrada de barra não reconhecida.

## Alternativas consideradas

**Manter `/cancel` como um alias para facilitar a descoberta**: rejeitada. A linha de status durante a execução e o `/help` nomeiam `Esc`, então um alias digitado acrescenta um caminho de código a manter e um aviso específico do estado ocioso para uma ação que uma única tecla já executa de forma mais direta. Nenhum consumidor precisava da rota de cancelamento por submissão do editor.

## Testes

`packages/ui/tui/tests/tui.spec.ts` verifica que `agent.cancelled` contém `'cancelled from terminal'`, acionado pelas teclas `Esc`/`Ctrl+C` naquele turno: o único recurso de cancelamento. Os snapshots `errors-and-help` e `disposed-terminal` fixam a linha do `/help` sem `/cancel`; a cobertura por arquivo em `packages/ui/tui/src` permanece em 100%.

## Consequências

Não há como cancelar um turno por submissão do editor; o cancelamento é exclusivo de atalho de teclado. Trata-se da remoção líquida de um caminho redundante e do seu aviso de estado ocioso, em linha com o formato de primitiva única que o restante da superfície de parada já segue ([public stop surface](2026-06-20-public-agent-stop-surface.md)). Restaurar um cancelamento digitado traria de volta a entrada de autocompletar, o ramo do handler de submissão e um teste próprio.
