# Agent Note: o tempo da etapa na TUI acompanha a última mensagem da etapa

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-tui-step-timing-trails-tool-cards.md) | Português

## Problema

O resumo de tempo por etapa (`Model wait … · Completed …`) era filho do componente de mensagem do assistente, então era renderizado logo abaixo do texto do assistente. Quando uma etapa disparava chamadas de ferramenta, os cartões de ferramenta eram acrescentados ao chat *depois* da mensagem do assistente, deixando a linha de tempo presa acima deles: uma mensagem antes da última saída real da etapa. O resumo existe para fechar uma etapa, então em qualquer etapa com chamadas de ferramenta ele aparecia no lugar errado.

## Decisão

O resumo de tempo é um `StepTimingComponent` próprio, e não mais um filho de `AssistantMessageComponent`. `StreamingAssistantComponent` é dono de um e o expõe como `timing`, mas o renderizador o anexa ao chat como um irmão que vem depois da mensagem do assistente. Sempre que um `tool/call` ou `tool/result` da etapa aberta acrescenta um cartão, `trailStreamingTiming()` move o rodapé de volta para o fim do chat, de modo que ele sempre acompanha a última mensagem da etapa. Em `step/end`, o rodapé é concluído no lugar em que está, já no fim, e permanece fixo enquanto a saída da etapa seguinte vem depois. `removeStreaming` e a reconstrução disparada pelo alternador de raciocínio desanexam e reanexam o rodapé junto com o seu componente de streaming.

A ordem dos eventos torna isso exato: dentro de uma etapa, o loop acrescenta `tool/call` e `tool/result` antes de `step/end`, então o rodapé é reposicionado enquanto `streaming` ainda está definido e é congelado quando a etapa termina.

## Alternativas consideradas

**Manter o tempo dentro da mensagem do assistente e reordenar os cartões de ferramenta para cima dele.** Rejeitada: os cartões de ferramenta pertencem ao trecho posterior ao texto do assistente que os solicitou; movê-los para cima da mensagem do assistente, para ficarem sob o tempo, deturparia a ordem do transcript.

**Recalcular um único rodapé final para o turno inteiro em vez de um por etapa.** Rejeitada: um turno com várias etapas mostra o tempo concluído de cada etapa, e fundi-los descartaria os grupos por etapa que os testes de tempo existentes fixam.

**Reposicionar o rodapé a partir de um handler exclusivo de `step/end`.** Rejeitada: os cartões de ferramenta são renderizados antes de `step/end`, então um rodapé movido só no fim da etapa já estaria no fim, mas não acompanharia uma nova renderização no meio da etapa, e o rodapé em execução (antes da conclusão) continuaria acima dos cartões de ferramenta durante o streaming.

## Consequências

- Em uma etapa com chamadas de ferramenta, o resumo de tempo é renderizado abaixo dos cartões de ferramenta, tanto enquanto o turno executa quanto depois que ele termina; os snapshots do pacote (`untrusted-controls`, `cordis-tools-pending`, `advanced-cards-*`, `code-mode-pending`, `dynamic-workflow-pending`, `surface-before-compaction`) e os transcripts de exemplo (`todo-plan`, `bash-terminal-card`, `code-mode`, `parallel-file-reads`, `dynamic-workflow`, `cordis-dynamic-toolchain`, `code-mode-dispatch-spill`) fixam a nova ordem.
- Um teste unitário verifica que o tempo concluído aparece depois da saída de ferramenta de uma etapa; ele falha na ordem anterior à correção.
