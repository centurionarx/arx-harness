# Agent Note: A linha de status da TUI sinaliza com um badge as mensagens de steering na fila

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-steering-queue-badge.md) | Português

## Problema

Enquanto um turno está em execução, um envio pelo editor chama `agent.steer()` e entra na fila de steering (direcionamento no meio da execução) atrás do turno em execução ([Agent Note da porta de entrada](2026-07-17-dedicated-full-screen-tui-front-door.md)). A linha de status em execução terminava apenas com a dica `Enter sends steering, Esc cancels`, de modo que pressionar Enter não dava nenhum retorno de que a mensagem havia chegado nem de quantas aguardavam para alcançar o modelo. Um usuário que fizesse steering várias vezes não conseguia distinguir a fila de uma tecla perdida.

## Decisão

A caixa de entrada do agent (agente) é a fila de steering autoritativa, mas a TUI não consegue observá-la; por isso o badge é uma contagem ao vivo reconstruída a partir dos eventos públicos `agent/queued` e `steering/message`, e não uma projeção da própria fila.

- A linha de status em execução é composta por `formatTurnStatus`, que insere um badge `${queued} queued · ` antes da dica `Enter sends steering, Esc cancels` quando `queued > 0` e mostra a dica simples em zero; o rótulo de fase e o tempo decorrido que vêm antes dele pertencem à [linha de status detalhada](2026-07-21-tui-verbose-status-line.md).
- `createTuiChat` é dono de um contador `pendingSteering`: `+1` a cada `agent/queued` deste agent cujo `info.steering` esteja definido, `-1` (com piso em zero) a cada evento de sessão `steering/message`, à medida que o loop drena uma mensagem, e zerado sempre que o agent sai de `running`.
- A contagem é atualizada no `Loader` ativo por meio de `setMessage`; a atualização não faz nada em estado ocioso porque o loader só existe durante um turno em execução.
- O zeramento fica na transição de `agent/status`, não em `setStatus`, porque `setStatus` também roda em mudanças de paleta no meio do turno e não pode limpar uma contagem ativa.

## Alternativas consideradas

**Derivar a contagem apenas do log da sessão** (enfileiradas menos drenadas, recalculado no replay). Rejeitada: um cancelamento limpa a caixa de entrada sem registrar uma drenagem no log, então o log não consegue distinguir uma mensagem drenada de uma descartada; a âncora de zerar quando o agent não está em execução é mais simples e se corrige sozinha a cada turno.

**Zerar dentro de `setStatus`.** Rejeitada: `setStatus` roda de novo em `applyColorScheme` no meio do turno, o que zeraria indevidamente uma contagem ativa; a transição de status é o único lugar em que um turno de fato termina.

**Remover o limite inferior do decremento.** Rejeitada: o steering criado pelo loop (por exemplo, motivos de continuação) registra `steering/message` no log sem um incremento correspondente enfileirado pelo usuário, o que levaria a contagem a ficar negativa; o piso em zero mantém o badge como um limite inferior, e não como uma mentira.

**Tornar configurável a redação ou um limiar.** Rejeitada: a regra de não fixar parâmetros ajustáveis no código visa o comportamento que varia entre deploys, não o texto da marca; as strings de `welcome` e da dica já são apresentação fixa.

## Consequências

- O badge é estado de UI ao vivo, de melhor esforço, e não uma superfície registrada em log: ele é reconstruído a partir de eventos e zerado a cada turno, nunca persistido, de modo que um turno em execução retomado começa o badge do zero.
- Um cancelamento com mensagens na fila limpa o badge corretamente pelo zeramento ao sair da execução, e uma drenagem além de zero não faz nada: nenhum dos dois consegue deixar para trás uma contagem desatualizada.
- Uma continuação do loop que mantém o agent em `running` enquanto reenfileira steering tardio não drenado pode contar a mais temporariamente até o próximo zeramento em estado ocioso; o badge é apenas indicativo, então essa janela é aceitável.
- `packages/ui/tui/src/index.ts` permanece com 100 % de cobertura por arquivo.

## Testes

`packages/ui/tui/tests/tui.spec.ts` conduz o frame de status em execução pelo `createTuiChat` real: a dica simples em zero, uma fila de outro agent ignorada, o incremento até `2 queued`, uma fila que não é de steering deixada intacta, o decremento à medida que cada mensagem é drenada, o limite inferior em uma drenagem além de zero e o zeramento quando o turno termina. Verificado ao vivo no tmux: o badge mostrou `3 queued` depois de três chamadas a `agent.steer()` e, em seguida, `1 queued` quando duas foram drenadas.
