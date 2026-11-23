# Agent Note: Enriquecimento do ciclo de vida do subagent — lastAssistantMessage (apenas observação)

Status: implemented
Archived: 2026-07-26

[English](2026-06-30-subagent-observe-enrich.md) | Português

## Problema

O subsistema de hooks ([Agent Note dos seams de interceptação](2026-06-30-interception-seams.md)) permite que um plugin observe e condicione o agent (agente) em pontos do ciclo de vida. O Claude Code e o Codex expõem hooks **SubagentStart / SubagentStop**, e os do CC carregam a mensagem final do subagent. O harness já emite os eventos de ciclo de vida `subagent/start` e `subagent/end` ([o seam de capacidade de subagent](2026-06-21-subagent-capability-seam.md)), mas os payloads deles eram mínimos (`provider`, `id` e, no fim, `stopReason`), o que não bastava para uma ponte de hooks relatar O QUE um subagent produziu sem recorrer separadamente à execução ao vivo.

Esta Agent Note enriquece o payload de fim. Ela é deliberadamente **apenas de observação**: nenhuma mudança de fluxo de controle e nenhum waterfall (evento em cascata). Uma decisão de parada de subagent que afete a execução (continuação, injeção que muda a execução) é um redesenho separado e maior, e fica fora do escopo.

## Decisão

**Adicionar `lastAssistantMessage`, a saída final do filho, a `SubagentRunEndInfo`.** No caminho de conclusão, ela é o `SubagentResult.output` tipado e somente leitura, de modo que um observador vê o que o filho produziu sem reter a execução. Em uma rejeição de infraestrutura, em que não existe `SubagentResult`, ela fica ausente e o evento relata `stopReason: 'error'`. Provedores e listeners são colaboradores confiáveis no mesmo processo e honram o contrato de payload imutável emprestado.

Os dois eventos continuam sendo **`emit`s** simples. O `SubagentService.start()` assíncrono anexa a observação do resultado à execução pronta do provedor, emite `subagent/start` e então retorna a execução; um listener no mesmo processo pode, portanto, alcançar o filho publicado por meio de `ctx.agents.get(info.id)`, enquanto um provedor remoto não precisa ter uma entrada no registry local. Um início de provedor rejeitado não emite nenhum dos dois eventos. Os callbacks continuam sendo apenas de observação, e a contenção por listener impede que um assinante defeituoso deixe uma execução ao vivo sem conclusão ou prive os listeners seguintes de receber o evento.

## Alternativas consideradas

**Um rótulo `agentType` de tipo de subagent** (o análogo, no harness, do `subagent_type` do CC) na requisição + nos dois payloads de ciclo de vida. Um rascunho anterior o entregava; ele foi descartado na revisão porque é um conceito do Claude Code que não se encaixa no nosso seam (nada aqui o interpreta, e o único consumidor era uma ponte no dialeto do CC). Em vez disso, a ponte do CC fornece o valor padrão de matcher do próprio Claude Code, `"general-purpose"`, ao matcher `agent_type` de SubagentStart/Stop, então esta Agent Note entrega UM enriquecimento: `lastAssistantMessage`.

**Um `subagent/end` com fluxo de controle**: adiado; veja abaixo.

## Por que apenas observação, e o que fica adiado

Um `subagent/end` com fluxo de controle (um waterfall aguardado que retorna uma decisão de parar/continuar, como os outros seams de interceptação) exigiria: mudar `subagent/end` de emit para waterfall, reestruturar `SubagentService.start` para aguardar os listeners antes de concluir e implementar a capacidade `resume` no provedor em processo, para que um "continue" possa de fato reexecutar o filho. Isso pertence ao redesenho de subagents em segundo plano/com steering (direcionamento no meio da execução) que a [Agent Note do seam de capacidade](2026-06-21-subagent-capability-seam.md) já adia (o mesmo redesenho que unifica o tratamento de ferramentas de longa duração entre subagents e bash). Esta Agent Note entrega o enriquecimento apenas de observação de que uma ponte de hooks precisa hoje; as âncoras `FIXME(subagent-continuation)` / `TODO` marcam onde a versão com fluxo de controle entraria, se e quando esse redesenho acontecer.

## Consequências

Uma ponte de hooks (ou um plugin nativo) agora pode encaminhar o `lastAssistantMessage` do filho a um handler de SubagentStop assinando os emits existentes, sem nenhuma superfície nova de fluxo de controle. A adição ao vocabulário está documentada em [docs/core-data-structures/subagent.md](../../../../docs/core-data-structures/subagent.md) (a prosa dos eventos) e nos dois READMEs de subagent; o catálogo foi regenerado. Nenhum comportamento de produção muda (os eventos disparam exatamente como antes, com um campo (opcional) a mais no payload de fim), então nenhuma mudança de snapshot ou de e2e é necessária.
