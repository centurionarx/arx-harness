# Agent Note: progresso ao vivo da compactação avulsa no terminal

Status: implemented
Archived: 2026-08-04

[English](2026-07-30-compaction-progress-visibility.md) | Português

## Problema

Uma compactação (compaction) manual avulsa roda entre turnos enquanto o agent (agente) permanece ocioso. Por isso, o indicador de fase de turno da TUI mantinha o cursor `>` simples durante toda a lenta operação de resumo, e uma tentativa falha não produzia nenhuma linha no transcript (registro textual da sessão) porque nenhum checkpoint substituto chegava. A apresentação de atividade precisa reutilizar o indicador de status existente sem introduzir um segundo local de status animado.

O log durável pode reter um `compact/start` sem par depois que um processo morre. Esse órfão é uma evidência útil para recuperação, mas não prova que há trabalho rodando no processo atual; fazer replay dele como progresso deixaria as sessões retomadas com um indicador fantasma permanente.

## Decisão

A TUI trata o par ao vivo que vai do `compact/start { turn: null }` avulso até o `compact/end` correspondente como a fonte da apresentação de compactação em andamento. Uma célula `compacting`, local ao módulo, registra o início no relógio de renderização e é dona de um único timer de animação. Uma linha fixa acima do prompt renderiza `Context being compacted <elapsed>` a partir desse relógio, o indicador de status de execução existente, de uma célula, renderiza `⊙` pelo mesmo caminho de esmaecimento e pulsação dos glifos de fase de turno, e o bit de progresso do terminal permanece ativo até o par se fechar.

O `runningPhaseGlyph` é dono da escolha entre os glifos de fase de turno, o `⊙` e o cursor ocioso. Os glifos de fase de turno têm precedência porque os pares de compactação numerados ficam contidos em um turno em execução cuja fase já acende o indicador. A linha fixa fica fora do transcript e não é dona de um spinner nem de outro timer; ela se recolhe quando está vazia. A célula de compactação não altera a borda do editor ocioso, a dica nem o selo de steering (direcionamento no meio da execução), de modo que os prompts continuam visivelmente aceitos enquanto a compactação avulsa reserva a admissão de turno.

A célula existe apenas ao vivo. A montagem e o replay do transcript nunca varrem o histórico em busca de um início sem par; somente uma notificação `session/event` observada pela TUI montada pode abri-la. As transições de status de turno preservam a célula, enquanto o encerramento do terminal limpa o timer e o bit de progresso dela.

No `compact/end`, a TUI limpa a célula antes de iniciar o esmaecimento comum do glifo. Um fim que carrega `error` acrescenta `Compaction failed: <error>` como aviso. A conclusão bem-sucedida continua representada pelo marcador de transcript do substituto que chegou, e a duração continua derivável dos timestamps duráveis de início e de fim correspondentes, sem outra linha definitiva.

Esta decisão substitui parcialmente apenas as cláusulas adiadas relativas a progresso na [decisão do transcript do terminal](../bug-fix/2026-07-29-human-transcript-append-origin.md) e na [decisão do transcript do navegador](../bug-fix/2026-07-30-web-transcript-log-ordered-projection.md): o progresso não exige escala de marcador nem uma refatoração da renderização do substituto. As duas notas continuam ativas e seguem donas da projeção de transcript por origem de append e dos marcadores de checkpoint que chegaram. A [decisão da compactação manual em fila](2026-07-30-queued-manual-compaction.md) continua dona da ordenação dos pares, do bloqueio e da classificação de órfãos desatualizados.

## Alternativas consideradas

**Adicionar `progressLabel` a `CommandDefinition` e um segundo controlador de status da TUI, como explorado no PR (Pull Request) #669.** Rejeitada porque os metadados de comando não são a autoridade do ciclo de vida da compactação, a compactação automática não se origina de um comando humano, e dois controladores de status podem discordar sobre o mesmo indicador.

**Adicionar `compacting` a `TurnPhase`, como explorado no PR #669.** Rejeitada porque a compactação avulsa deliberadamente não tem turno, enquanto a compactação numerada já tem uma fase visível de turno em execução.

**Adicionar um quinto `TimingBucket`.** Rejeitada porque os buckets de tempo particionam uma etapa de modelo aberta e alimentam o rodapé dela no transcript. A compactação avulsa não tem transição de etapa, e um novo bucket acrescentaria uma coluna de compactação sem sentido ao total de cada etapa.

**Compartilhar um único timer entre os estados de execução, de esmaecimento e de compactação.** Rejeitada porque o esmaecimento é dono de um timer que se encerra sozinho, enquanto a compactação ao vivo tem um tempo de vida independente de abertura e fechamento. Compartilhar reestruturaria a máquina de estados de animação já revisada sem remover um timer concorrente de fato.

**Varrer o log em busca de um `compact/start` sem par.** Rejeitada porque um órfão desatualizado de um ciclo de vida de processo anterior é histórico durável esperado. Somente a notificação ao vivo prova trabalho atual.

**Usar um indicador genérico de comando em execução.** Rejeitada para este comportamento porque o par de compactação é a fonte mais precisa e também cobre caminhos que não passam por comando. Um futuro indicador genérico de comando pertence ao ciclo de vida `command/run` / `command/done`.

**Adicionar uma linha de compactação animada ao transcript.** Rejeitada porque isso cria um segundo ponto de animação de status para o mesmo ciclo de vida. O indicador existente de uma célula é dono da atividade, enquanto o marcador que chegou e o aviso de falha são donos da apresentação definitiva no transcript.

**Imprimir um aviso de sucesso com a duração.** Rejeitada porque o substituto que chegou já fornece o marcador de conclusão. Os timestamps do par preservam a duração para uma apresentação futura que justifique outra linha no transcript.

## Consequências

A compactação manual tem uma exibição nomeada de tempo decorrido acima do prompt enquanto o agent está ocioso, a falha tem um aviso direto, e um órfão retomado nunca parece ativo. O indicador do prompt continua com uma célula de terminal de largura, enquanto a linha e o indicador reutilizam a animação de status, a paleta semântica e o ciclo de vida de progresso do terminal já existentes.

A célula ao vivo e o timer são estado adicional local ao processo, limpo tanto no fechamento do par quanto no encerramento da TUI. Trata-se, intencionalmente, de estado de apresentação não reconstruível: o histórico durável fornece o marcador de sucesso e os fatos de tempo, enquanto somente a observação no processo atual fornece a atividade.

Os testes da TUI no nível do pacote fixam o início avulso, a atualização do tempo decorrido, a apresentação com indicador único, a exclusão do início numerado, o esmaecimento, o aviso de falha, a preservação do status ocioso, a precedência do turno em execução, a retomada com órfão e o dispose (liberação de recursos) do timer. O cenário de TUI de produto removido observava `Context being compacted 1.0s` e `dsh ⊙` ao longo de uma fronteira real de resumo mantida em espera; uma futura implantação de terminal é dona dessa jornada montada.
