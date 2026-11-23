# Agent Note: A linha de status em execução mostra a fase do turno e o tempo decorrido

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-verbose-status-line.md) | Português

## Problema

Enquanto um turno estava em execução, a [TUI de tela cheia](2026-07-17-dedicated-full-screen-tui-front-door.md) mostrava um único spinner estático "Working". Ele não informava nem quanto tempo a etapa atual havia levado nem o que o agent (agente) estava fazendo (aguardando o modelo, pensando, transmitindo uma resposta em streaming ou executando ferramentas), de modo que um turno lento ou travado era indistinguível de um rápido.

## Decisão

- Enquanto um turno está em execução, a linha de status acima do editor mostra um rótulo de fase derivado com o tempo decorrido, mantendo no final a dica `— Enter sends steering, Esc cancels`. As quatro fases e seus rótulos são `waiting` → "Waiting for the first token", `thinking` → "Thinking", `responding` → "Responding" e `executing` → "Executing tools".
- A fase é estado de apresentação que a TUI deriva de eventos de sessão ao vivo, não um evento de sessão nem um status do agent próprio. `step/start` entra em `waiting`; um delta de raciocínio ou um início de bloco de raciocínio de `assistant/chunk` entra em `thinking`; um delta de texto ou um início de bloco de texto entra em `responding`; um `tool/call` entra em `executing`. O mapa de eventos é extensível por merge, então todo outro tipo de evento cai em um default e deixa a fase inalterada.
- O rótulo informa dois relógios, `<phase> <phase-elapsed> · total <step-elapsed>`, exceto em `waiting`, que mostra apenas o total da etapa. O relógio da fase é reiniciado em uma mudança de fase genuína ou em uma nova etapa; o relógio da etapa é reiniciado em `step/start`. As durações são formatadas como `8s` abaixo de um minuto e `1m05s` a partir de um minuto. O tempo de ferramenta entre `step/end` e o `step/start` seguinte é somado ao total da etapa que está terminando.
- Um único controlador `RunningStatus` (o loader, a fase, as duas linhas de base e um timer de atualização) existe apenas enquanto um turno está em execução. Um `setInterval` de um segundo atualiza o tempo decorrido; um evento de fase o atualiza imediatamente. `clearStatus` limpa o intervalo, para o loader e descarta o controlador, de modo que nenhuma transição para ocioso ou para disposed deixa um timer ativo, em linha com a higiene de timers do [banner sem borda](2026-07-21-tui-borderless-banner.md). Uma reconstrução de paleta no meio do turno (`setStatus` deriva de novo a borda do editor em uma mudança de esquema de cores do terminal) leva adiante a fase e as duas linhas de base, de modo que um status em execução nunca volta de repente para `waiting`.

## Alternativas consideradas

**Emitir a fase como evento de sessão ou status do agent.** Rejeitada: a fase é um detalhe de apresentação que a TUI reconstrói a partir de eventos já registrados em log. Uma fase durável e visível ao modelo exigiria um novo evento de sessão pela regra visível ao modelo ⟺ registrado em log, sem nenhum benefício para o modelo.

**Reutilizar o timer de animação do `Loader` do pi-tui para atualizar o texto de tempo decorrido.** Indisponível: o `Loader` vendorizado anima apenas o glifo do spinner, e não cabe a nós alterar o dist dele. A TUI é dona de um intervalo separado de um segundo, limpo no teardown.

**Inferir a fase a partir do estado de drenagem de ferramentas ou do componente de streaming.** Rejeitada: os eventos de ciclo de vida `step/start`, `assistant/chunk` e `tool/call` são sinais mais limpos, já tratados no mesmo listener ao vivo, e evitam acoplar a linha de status a outros componentes.

**Mostrar apenas o tempo decorrido, ou apenas a fase.** Rejeitada: os dois são desejados. O tempo por fase responde o que o agent está fazendo, e o total por etapa responde quanto tempo a etapa levou.

## Consequências

- A linha de status exibe, por exemplo, `Thinking 4s · total 8s — Enter sends steering, Esc cancels`, de modo que a atividade atual do agent e a duração da etapa ficam legíveis e um travamento fica visível.
- A detecção de fase é apresentação de melhor esforço: um tipo futuro de chunk ou de evento não tratado deixa a última fase no lugar e nunca lança exceção.
- Exatamente um `setInterval` roda por turno ativo, limpo junto com o controlador em toda transição para ocioso ou para disposed e no encerramento.

## Testes

`packages/ui/tui/tests/tui.spec.ts` fixa cada rótulo de fase contra o evento que o dispara (`step/start`, deltas e inícios de bloco de raciocínio e de texto, `tool/call`), que uma nova etapa reabre a janela de espera, que o tempo decorrido avança pelo timer do próprio controlador além de um segundo, que uma etapa além de um minuto renderiza `1m…`, que uma mudança de esquema de cores no meio do turno preserva a fase e o tempo decorrido e que um evento ao vivo que chega antes de o turno rodar não altera nenhum status. Verificado ao vivo no tmux.
