# Agent Note: IconActions e relógios das mensagens na web

Status: implemented
Archived: 2026-08-07

[English](2026-07-29-web-message-icon-actions-and-clock.md) | Português

## Problema

O balão do usuário no chat web já tinha as IconActions de copiar / branch / editar, mas nenhum relógio. A narração finalizada do assistente não tinha chrome de ações abaixo do corpo, embora o design do Harness mostre uma linha de copiar / branch / relógio depois que a resposta assenta. As respostas em streaming não podem exibir esse chrome de relance no meio dos tokens. As linhas memoizadas também mantêm props estáveis ao cruzar a meia-noite, então um `Date.now()` avaliado uma única vez deixaria as mensagens de ontem presas em `HH:mm`.

## Decisão

**Os balões do usuário acrescentam um relógio local sensível à data no início da linha de IconActions existente; o último assistente com texto de conteúdo de cada turno acrescenta ao final uma linha de copiar / branch / relógio com `margin-top: 16px`; as duas posições permanecem visíveis sempre que montadas e são reformatadas na próxima meia-noite local.**

A posição do assistente é restringida pela [decisão do turno concluído](../bug-fix/2026-08-05-turn-tail-actions-require-a-completed-turn.md): só um turno com `turn/end` a concede, então um turno que ainda produz etapas não entrega a linha a ninguém. O controle de branch da posição do usuário é removido por completo pela [remoção do branch no balão do usuário](../simplification/2026-08-06-user-bubbles-drop-the-branch-action.md); as IconActions de uma linha do usuário são relógio e copiar.

As duas posições formatam `node.time` por meio de `formatMessageClock`: mesmo dia do calendário → `HH:mm`, antes neste ano → uma forma mês-dia seguida de `HH:mm`, outros anos → uma forma ano-mês-dia seguida de `HH:mm`. `useCalendarDay` é um tique de dia local ao componente (timeout até a próxima meia-noite local), para que as linhas memoizadas sejam renderizadas de novo quando o dia do calendário muda, sem um novo hook de framework. `MessageItem` coloca o rótulo antes de copiar (figma `388:20051`). `ChatView` deriva os seqs de fim de turno via `assistantActionsSeqs` e retém `time` para o conteúdo de meio de turno; `AssistantMarkdown` coloca a linha depois de branch (figma `43:32997`) apenas quando `streaming` é false, o horário do evento é conhecido e o nó tem conteúdo de texto não vazio. Os nós só com Think, a narração de meio de turno e a cauda em streaming omitem a linha. Copiar grava os blocos de texto unidos. As duas linhas de mensagem passam o `seq` de seu evento ao mesmo callback de fork; [Web session fork actions](2026-07-27-web-session-fork-actions.md) define o contrato real de mutação. A escrita na área de transferência e os helpers de relógio vivem em `message-chrome.ts`. A superfície montada é fixada por `apps/web/tests/message-actions.e2e.ts` (histórico semeado a frio + golden de aria); a normalização de aria reduz todo formato de relógio a `{{clock}}`.

## Alternativas consideradas

**Mostrar as IconActions do assistente durante o streaming.** Rejeitada: o pedido é revelar a linha só depois que a saída termina; o chrome no meio do stream piscaria e convidaria a copiar uma resposta parcial.

**Colocar IconActions sob todo nó de assistente finalizado (inclusive os só com Think).** Rejeitada: copiar não tem nada de útil a gravar sem conteúdo de texto, e repetir o chrome sob cada linha de etapa/Think polui o fluxo; só a saída de conteúdo é dona da posição.

**Colocar IconActions sob todo assistente com texto de conteúdo em um turno de várias etapas.** Rejeitada: a narração de meio de turno (texto antes das ferramentas) não é a resposta assentada; repetir copiar/branch/relógio sob cada etapa polui o fluxo. Só o último assistente de conteúdo do turno é dono da posição.

**Revelar a linha de ações ao passar o mouse em ponteiros com suporte a hover.** Rejeitada: uma vez que a linha existe, ela deve continuar fácil de descobrir; ocultar por opacidade tornava o chrome fácil de passar despercebido e exigia seletores de hover no pai que duplicavam a condição de montagem.

**Deixar a decisão das IconActions definir também a semântica de fork de sessão.** Rejeitada: esta nota é dona apenas do chrome de mensagem, dos relógios e da condição de montagem; a seleção de fronteira, o comportamento em caso de falha e a semântica de troca pertencem à nota separada [Web session fork actions](2026-07-27-web-session-fork-actions.md), o que impede os componentes de apresentação de se tornarem uma segunda casa para a mutação de sessão.

**Publicar o dia do calendário por meio de um store de chat ou de um hook de inject.** Rejeitada: o tique de dia é estado local exclusivo de apresentação, sem consumidores entre entradas; um timeout local ao componente segue a regra do cliente de que hooks comportamentais podem ser donos de estado que não assina uma fonte externa.

## Consequências

A última resposta de conteúdo assentada de cada turno expõe copiar, branch e o relógio do evento assim que a linha é montada; o conteúdo de meio de turno e os nós só com Think ficam sem chrome. Os relógios do usuário e do assistente compartilham as mesmas regras de ampliação por dia/ano e se atualizam depois da meia-noite sem mutação de mensagem. A paginação por mensagem continua sendo uma posição de rodapé adiada no README do pacote. Os testes de pacote fixam os três formatos de relógio, a ampliação à meia-noite, a condição de assistente só com conteúdo, a condição de seq de fim de turno e os respectivos valores de `seq` de evento passados pelos botões de branch do usuário e do assistente; o cenário e2e web fixa o chrome de IconActions montado.
