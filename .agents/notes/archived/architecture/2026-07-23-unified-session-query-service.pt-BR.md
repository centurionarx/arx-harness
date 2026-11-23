# Agent Note: Serviço unificado de consulta de sessões

Status: implemented
Archived: 2026-07-26

[English](2026-07-23-unified-session-query-service.md) | Português

## Problema

Leituras exatas, filtros semânticos, rastreamentos de relacionamento e busca de texto completo operam sobre o mesmo corpus de sessões, que dá preferência às sessões vivas. Expor a busca de texto completo sob uma segunda chave de contexto faz consumidores e composições de aplicação tratarem uma única capacidade como dois serviços, embora a implementação em SQLite seja a única parte específica de backend.

O pacote de interface já é dono dos contratos compartilhados de registro, filtro, rastreamento, requisição de busca, cursor e erro. Um registry de provedores ou um coordenador acrescentaria uma semântica de seleção em tempo de execução que nenhum consumidor atual exige.

## Decisão

`SessionQueryService` é o único serviço abstrato registrado como `ctx.sessionQuery`. Ele implementa de forma concreta a listagem, as leituras de título e de eventos, as leituras de superfície, a filtragem e o rastreamento de relacionamentos por meio do seu `SessionCorpus`, que independe de backend. Seus únicos métodos abstratos são `searchSessions()` e `searchEvents()`.

`SessionQuerySqlite` estende esse serviço e é o único backend concreto. Uma instância montada expõe, portanto, todas as operações por `ctx.sessionQuery`; as operações exatas herdadas usam a implementação compartilhada do corpus, enquanto o ciclo de vida que pertence ao SQLite observa as fontes, reconcilia o índice FTS derivado, classifica as correspondências e é dono das gerações de cursor. O pacote de interface não tem plugin concreto autônomo, registry de provedores de busca nem segunda chave de contexto.

A reconciliação do SQLite é uma única máquina de estados serializada que alcança a parada completa. Ela repassa o sinal de abort exato de quem chama para a listagem e a inspeção de snapshots duráveis, aguarda ela mesma cada operação de backend iniciada e verifica o cancelamento depois de cada await e antes de iniciar a próxima operação de fonte ou de índice. Assim, o cancelamento não consegue liberar o serializador enquanto uma chamada de backend ignorada ou cooperativa ainda está limpando seus recursos, nem consegue iniciar uma listagem, inspeção, reconciliação ou consulta seguinte depois que o sinal é observado.

A configuração do backend inclui a opção herdada `readWindowMax` ao lado do seu próprio caminho de índice, modo de journal, limites de página e limite de trecho. As aplicações próprias que precisam de consultas de sessão montam o backend SQLite e colocam o índice descartável dele ao lado da raiz de persistência configurada.

Esta topologia de serviço substitui a parte de chaves separadas da [decisão de consulta exata](../feature/2026-07-10-session-query-service.md) e da [decisão de busca em SQLite](../feature/2026-07-10-sqlite-session-query-provider.md); as decisões delas sobre corpus, consulta, tokenizador, reconciliação e segurança continuam em vigor.

## Alternativas consideradas

- **Manter `ctx.sessionQuery` e `ctx.sessionSearch` separados** — rejeitado porque ambos expõem operações sobre um único corpus lógico, obrigam os consumidores a descobrir duas chaves e permitem que aplicações montem por acidente apenas uma superfície parcial de consulta.
- **Manter um serviço base concreto e deixar o plugin SQLite registrar ou alterar dois métodos de busca** — rejeitado porque a disponibilidade dos métodos dependeria da ordem dos plugins e do teardown, e o serviço precisaria de um protocolo de registro de provedores para uma única implementação.
- **Mover todas as implementações de consulta para o pacote SQLite** — rejeitado porque leituras exatas, filtros e rastreamentos não exigem índice e são comportamento compartilhado, que pertence ao lugar onde ficam seus contratos independentes de provedor.

## Consequências

Os consumidores injetam um único serviço e podem combinar operações exatas e de texto completo sem uma segunda busca de capacidade. Uma composição de produção precisa escolher um backend concreto mesmo quando um consumidor chama, por ora, apenas métodos exatos herdados; os testes podem usar uma subclasse mínima quando o comportamento de backend está fora do escopo deles.

O objeto unificado mantém deliberadamente duas estratégias internas de observação: as operações exatas leem, a cada chamada, as fontes vivas/persistidas que têm autoridade, enquanto as operações de texto completo reconciliam um índice descartável. Compartilhar a chave de contexto não dá autoridade ao índice derivado nem acopla a disponibilidade de leituras exatas a uma consulta FTS.

O cancelamento de operações enfileiradas continua imediato. O cancelamento durante uma observação assíncrona de fonte em andamento espera essa operação iniciada terminar, o que faz da rejeição um ponto de parada completa e preserva a execução em fila única para uma busca seguinte. As instruções síncronas do SQLite continuam não preemptíveis e ficam cercadas por verificações de sinal.

A cobertura unitária fixa o comportamento herdado e o abstrato em uma única chave, a cobertura do SQLite exercita as duas famílias de operações no backend concreto, e o caminho real do Loader verifica que um único plugin exportado registra o serviço combinado.
