# Agent Note: Snapshots do estado semântico do terminal para a TUI

Status: implemented
Archived: 2026-08-04

[English](2026-07-18-tui-terminal-state-snapshots.md) | Português

## Problema

A TUI é um renderizador com estado. O resultado visível ao usuário depende do parsing de ANSI, dos frames diferenciais, da quebra de linha, do scrollback, da posição do viewport, da largura do terminal, do foco, do estado do cursor e da intenção de apresentação de cada ferramenta. Testes unitários que coletam fragmentos de `Terminal.write()` conseguem provar o tratamento de eventos, mas não conseguem provar a tela final que um terminal exibe. A mesma tela também pode ser emitida por fragmentos de escrita diferentes, então fixar esses fragmentos cria regressões falsas.

Os snapshots de linhas de componente param antes de o ANSI chegar a um terminal e deixam de fora o movimento do cursor, a limpeza, a estilização, a composição de overlays e o reflow. As capturas de tela raster incluem ruído de fonte e de renderização da plataforma que não tem relação com o contrato da TUI. Um fluxo concluído construído pela anexação direta de eventos de sessão plausíveis tem outro ponto cego: ele prova que o renderizador aceita aqueles formatos, não que o agent loop (ciclo do agent) de produção e as implementações de ferramenta os produzem.

A TUI reutilizável precisa, portanto, de uma representação determinística e revisável do estado do terminal. Um deploy de produto que a entrega precisa, além disso, de jornadas de modelo gravadas que atravessem a pilha montada e de um teste menor na fronteira real de processo e de PTY.

## Decisão

A cobertura da TUI reutilizável tem duas camadas de pacote complementares:

1. `packages/ui/tui/tests/tui.spec.ts` testa diretamente o mapeamento de eventos, o roteamento de entrada, o dispose (liberação de recursos) e o comportamento de erro.
2. `packages/ui/tui/tests/tui.snapshot.ts` monta a TUI de produção contra um emulador de terminal headless para os estados transitórios que um log de sessão concluído não consegue reter: streaming em andamento, chamadas de ferramenta pendentes, overlays, expansão, reflow de compactação (compaction), erros e encerramento.

A [decisão do ponto de entrada com configuração explícita](../simplification/2026-08-03-explicit-config-dsh-entrypoint.md) removeu a composição da TUI de produto, as jornadas de aplicação gravadas e a suíte de PTY. Um deploy que entrega uma porta de entrada de terminal é dono dessas camadas de aplicação montada; os testes de pacote não alegam essa cobertura de produto.

### Replay de aplicação removido

A suíte de aplicação excluída dava a cada cenário `session.jsonl`, logs filhos opcionais `session.<n>.jsonl` e `terminal.expected.txt`. O log principal fornecia os prompts `user/message` escritos pelo usuário e a sequência `assistant/chunk` gravada. O `dsh-llm-replay` derivava um roteiro de chamadas de modelo por sessão e era a única fronteira com mock; o agent loop, as ferramentas, os workers, os presenters e a TUI eram implementações de produção.

Essa suíte rejeitava uma jornada quando a sequência de chamadas de ferramenta diferia, quando faltava uma contagem de eventos esperada, quando um resultado de ferramenta era um erro, quando um turno terminava em erro, quando um ciclo de vida de workflow ficava incompleto ou quando a contagem de sessões filhas ao vivo diferia do conjunto de fixtures (dados de teste pré-montados). Essas verificações continuam sendo o padrão de aceitação para qualquer futuro deploy de terminal; elas não são mais fixtures entregues.

O workflow de gravação removido usava `DSH_SNAPSHOT=record` para as jornadas de modelo e `DSH_SNAPSHOT=refresh` para a saída de terminal derivada. A remoção do ponto de entrada de produto também removeu esses modos da trilha de snapshots do repositório; os snapshots da TUI reutilizável são escritos diretamente a partir dos cenários de pacote.

### Projeção semântica do terminal

O `HeadlessTerminal` local ao pacote implementa a mesma interface `Terminal` do pi-tui que o terminal de processo e alimenta cada escrita ANSI no parser fixado do `@xterm/headless`. O código de snapshot espera os frames sincronizados se aquietarem antes de ler o estado. O checkpoint de streaming congela o intervalo do loader, mas permite um atraso real de relógio de parede ao longo de um tick de animação, de modo que fixa o status semântico, e não o glifo de spinner que o escalonador por acaso renderizou.

Cada saída esperada projeta em texto as dimensões, as coordenadas do buffer ativo e do viewport, o estado de ciclo de vida e do cursor, as linhas, os marcadores de quebra e os intervalos de estilo fora do padrão. Os cartões com muita rolagem capturam o buffer usado; os overlays capturam o viewport visível. Texto e estilo ficam separados para que um revisor consiga distinguir mudanças de conteúdo de mudanças de apresentação sem decodificar bytes ANSI.

Todo checkpoint impõe a independência de tema no estado completo do terminal: nenhuma cor RGB, nenhuma entrada de paleta além de ANSI 0–15 e nenhuma cor de fundo explícita. O vídeo reverso continua válido para seleção porque usa os padrões do terminal. As duas suítes são donas de inventários fechados que rejeitam cenários ausentes, checkpoints ausentes e arquivos de saída esperada órfãos.

### Matriz de cenários obrigatórios

| Camada | Cenário | Contrato fixado |
|---|---|---|
| Estado transitório | Streaming e chamadas avançadas pendentes | Raciocínio/texto em andamento mais os cartões pendentes de Code Mode, de workflow e de Cordis que desaparecem dos logs concluídos |
| Estado transitório | Cartões, interação, layout, falha e encerramento | Famílias de cartões recolhidos/expandidos, validação de perguntas, substituição por compactação, reflow no redimensionamento, ajuda/erros, restauração do cursor e parada do terminal |

## Alternativas consideradas

- **Fazer snapshot das escritas brutas do terminal**: rejeitado porque a renderização diferencial pode mudar as fronteiras de escrita sem mudar a tela, enquanto as sequências de cursor e de limpeza são ilegíveis na revisão.
- **Fazer snapshot das linhas de renderização dos componentes antes da saída do terminal**: rejeitado porque isso não testa o parsing de ANSI, o movimento do cursor, os overlays, o comportamento do viewport nem componentes independentes em um mesmo frame.
- **Construir todo fluxo concluído pela anexação de eventos de sessão**: rejeitado porque uma sequência de eventos escrita à mão pode divergir do agent loop, da execução de ferramentas, da vinculação de sessões filhas ou do comportamento dos workers enquanto o teste de apresentação dela continua verde. A construção direta de eventos fica limitada aos estados transitórios do renderizador.
- **Reutilizar as saídas esperadas de stdout do ACP (Agent Client Protocol) como oráculo da TUI**: rejeitado porque uma jornada de modelo gravada é neutra em relação ao transporte, mas a apresentação dela não é. Um deploy de terminal é dono da própria saída esperada, embora possa reutilizar o mesmo vocabulário de replay em JSONL.
- **Versionar capturas de tela raster**: rejeitado porque fontes, métricas de glifos, antialiasing e temas do terminal do host as tornam sensíveis à plataforma e dificultam a revisão de mudanças semânticas de estilo.
- **Usar apenas testes de ponta a ponta com PTY**: rejeitado porque a saída bruta de PTY é um stream de operações de desenho históricas, não um estado final consultável. Os testes de PTY conservam a fronteira real de Loader/entrada/teardown, enquanto o emulador é dono da cobertura ampla de estado.

## Consequências

- Os snapshots de pacote falham quando o mapeamento de eventos ou a apresentação da TUI quebra; eles não substituem o transcript (registro textual da sessão) do caminho de ferramentas de uma aplicação montada.
- As regressões visuais da TUI produzem diffs legíveis de células e de estilo, enquanto as fixtures JSONL conservam os chunks exatos do modelo que fizeram o caminho de produção executar.
- O emulador usa a API de buffer proposta do xterm. Uma atualização do xterm exige rodar de novo e revisar a projeção semântica; o comportamento específico de terminal ainda precisa de um teste de fumaça de PTY que pertença ao deploy que o entrega.
- As saídas esperadas codificam deliberadamente o comportamento de quebra de linha e de viewport em tamanhos fixos. As mudanças intencionais de layout atualizam e revisam os snapshots semânticos do pacote.
