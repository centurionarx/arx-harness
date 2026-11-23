# Agent Note: Remover as superfícies de conveniência montadas de LLM sem consumidor

Status: implemented
Archived: 2026-07-26

[English](2026-06-20-drop-unconsumed-llm-assembled-surfaces.md) | Português

## Problema

`LlmService` ([packages/llm/llm/src/index.ts](../../../../packages/llm/llm/src/index.ts)) expõe três superfícies de chamada sobre um modelo:

- `stream()`: `StreamChunk`s brutos, despachados pelo waterfall (evento em cascata) `llm/stream`.
- `streamBlocks()`: uma "visão de conveniência" que passa os chunks por um `BlockAssembler` e entrega `ContentBlock`s concluídos na ordem do stream ([index.ts:137-144](../../../../packages/llm/llm/src/index.ts)).
- `generate()`: um único `GenerateResult` totalmente montado, despachado por um segundo waterfall, `llm/generate` ([index.ts:151-157](../../../../packages/llm/llm/src/index.ts)).

O único consumidor de produção do serviço de LLM (modelo de linguagem de grande porte) é o agent loop (ciclo do agent), e ele usa exclusivamente `stream()`: alimenta o próprio `BlockAssembler` com os chunks brutos, para poder registrar os chunks no log com fidelidade de replay enquanto monta em paralelo ([packages/core/agent-loop/src/loop.ts](../../../../packages/core/agent-loop/src/loop.ts), a etapa `ctx.llm.stream(req)`). Uma busca por `streamBlocks` e `ctx.llm.generate` em `packages/*/src` e `examples/*/src` não encontra nenhum chamador de produção. As referências são os métodos do serviço, a documentação e os testes; os testes de adaptador usam `generate()` como um condutor conveniente, mas podem drenar `stream()` manualmente pelo mesmo helper de montagem, sem preservar uma API pública de produção.

Este é o padrão de [drop-mutable-session-summary](2026-06-19-drop-mutable-session-summary.md): APIs de visão montada com contratos testados, consumidas por testes, e não pela produção. Elas foram construídas de forma especulativa para consumidores que não se importam com deltas no nível de token, mas o único consumidor real se importa com os deltas justamente para poder persistir dados de replay de alta fidelidade.

`streamBlocks()` arrasta consigo uma fatia dedicada de `BlockAssembler`: `flushReady()` e `flushRemaining()` ([packages/llm/llm/src/assembler.ts:138-168](../../../../packages/llm/llm/src/assembler.ts)), mais o campo de cursor `flushed`, existem apenas para sustentar a entrega incremental em ordem. `generate()` arrasta `GenerateResult`, `BlockAssembler.result()` e o waterfall `llm/generate` como uma segunda superfície de interceptação sobre o mesmo stream subjacente. O uso que o loop faz do assembler é `push()` / `message()` / `usage` / `finish`, e não o flush em streaming nem a montagem de uma só vez pelo serviço.

## Decisão

`stream()` é a única superfície pública de chamada de LLM. Remover `streamBlocks`, `generate`, os tipos de evento/resultado deste e os helpers do assembler usados apenas por esse caminho. Os testes de adaptador montam o stream público por meio de um helper local, enquanto `BlockAssembler` mantém apenas as operações que têm consumidores de produção.

## Alternativas consideradas

**Manter `generate()` como uma conveniência só de teste**: rejeitada. Os testes de adaptador que drenam `stream()` manualmente pelo assembler compartilhado exercitam o mesmo caminho de streaming que a produção usa, e um método público cujos únicos chamadores são testes é exatamente o tipo de superfície morta que [o precedente drop-mutable-summary](2026-06-19-drop-mutable-session-summary.md) aposentou. Um consumidor futuro que queira blocos montados sem deltas reintroduz um helper focado junto com esse consumidor.

## Verificação

`streamBlocks`, `generate`, `llm/generate` e os helpers do assembler que só eles exigiam foram removidos, sem novos exports mortos; os dois adaptadores reais são exercitados por meio de `stream()` e do assembler compartilhado; o loop se comporta de forma idêntica (as saídas esperadas dos snapshots de ACP ficaram inalteradas); e o README, o documento de arquitetura e a documentação dos módulos não trazem nenhuma menção às superfícies removidas.

## Consequências

- **Remove métodos públicos de um pacote de vocabulário do core.** Um plugin futuro que queira blocos montados sem deltas precisaria chamar `stream()` e usar `BlockAssembler` diretamente, ou reintroduzir um helper focado com um consumidor real. Dada a postura de pré-lançamento, de "fundação acima de futuro especulativo" ([AGENTS.md](../../../../AGENTS.md)), este é o momento certo para cortar um formato público usado só por testes.
- **Os testes de adaptador ficam um pouco mais explícitos.** Eles perdem o wrapper ergonômico `generate()`, mas essa é uma pressão útil: os testes exercitam o mesmo caminho de streaming que a produção usa.
- **Os usuários de waterfall perdem `llm/generate`.** Não existe nenhum listener de produção. Qualquer plugin futuro de cache/retry/logging deve envolver `llm/stream`, que continua sendo o único caminho de chamada ao provedor.

O tamanho é modesto, mas é uma remoção limpa de área de superfície especulativa do pacote de LLM, que deixa um único contrato de chamada de modelo para a produção e para os testes.
