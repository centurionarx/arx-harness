# Agent Note: Catálogo gerado de configuração de plugins

Status: implemented
Archived: 2026-07-27

[English](2026-07-06-generated-config-catalog.md) | Português

## Problema

O repositório não tinha uma referência de configuração de plugins respaldada pelo código-fonte. Os READMEs dos pacotes documentavam os campos de forma inconsistente, não enumeravam quais pacotes são carregáveis e não verificavam se os schemas de runtime concordam com os tipos de configuração declarados.

## Decisão

O `scripts/gen-config-catalog.ts` emite [docs/config-catalog.md](../../../../docs/config-catalog.md) a partir do tipo de configuração declarado e do JSDoc de cada plugin, com os requisitos de injeção, os links para tipos referenciados e um ponteiro para o código-fonte. Os tipos locais do pacote são incluídos transitivamente; os tipos do workspace e os externos são linkados ou nomeados. Os modos determinísticos `--write` e `--check` fazem da página versionada um artefato gerado.

A geração puramente por AST é correta aqui pelo mesmo motivo que vale para o catálogo de eventos/serviços e que NÃO vale para o catálogo de ferramentas: um tipo de configuração é uma declaração estática, e todo schema do schemastery no repositório é um literal estático `z.object`/`z.intersect`, então o código-fonte é a verdade inteira; nada na superfície de configuração é composto em tempo de execução.

Escolhas específicas:

- **O tipo de configuração é o tipo do segundo parâmetro.** O que o catálogo documenta é o tipo declarado de `apply(ctx, config)` / do `(ctx, config)` do construtor do serviço, o valor que o cordis de fato passa, e não um export `Config` localizado por convenção de nomes. É isso que torna a travessia total: ela funciona para interfaces chamadas `AcpConfig` ou `BasicCompactConfig`, para tipos declarados em um arquivo irmão e para plugins sem nenhum schema de validação.
- **A classificação é total.** Toda entrada `packages/<group>/<pkg>` resolve, espelhando o `unwrapExports` do Loader (`exports.default ?? exports`), para um plugin configurável, um plugin sem configuração, uma classe abstrata de seam ou uma biblioteca, cada um renderizado em sua própria seção, e uma entrada inclassificável gera erro fatal. Um pacote novo não pode ficar sem documentação em silêncio.
- **O JSDoc por campo é obrigatório.** Toda propriedade de uma declaração colada (inclusive literais de tipo aninhados) precisa de prosa JSDoc não vazia, ou a geração falha. A colagem É a documentação, então esta é a mesma função de coerção que o catálogo de eventos aplica via `@mode`: docs de código-fonte ralos fazem a gate falhar em vez de produzir um catálogo ralo.
- **As chaves do schema são verificadas contra o tipo declarado.** O gerador resolve caminhos de objetos e arrays aninhados por meio de tipos locais e do workspace. Caminhos comprovadamente ausentes falham; estruturas externas ou dinâmicas que não podem ser enumeradas são puladas. A verificação é intencionalmente de mão única, porque os tipos declarados podem conter campos exclusivos de runtime excluídos da configuração do loader.
- **Uma cerca dedicada.** As declarações coladas usam uma info string ` ```ts config-catalog ` que o `doc-typecheck` pula (uma declaração isolada que referencia tipos importados não compila sozinha), excluída da proporção de opt-out: o mesmo tratamento que as cercas `cordis-catalog` e `persistence-catalog` recebem.
- **Um único arquivo em `docs/config-catalog.md`**, não um diretório de um arquivo só: a página atende a um público (quem escreve o `cordis.yml`) com um único eixo, ao contrário de `cordis-catalog/`, que guarda duas páginas irmãs.

As seções `## Config` dos READMEs dos pacotes permanecem. A sobreposição é aceita deliberadamente: o README é o contrato curado por pacote (a semântica da configuração no contexto de deploy, ao lado das limitações e dos pontos de extensão), e o catálogo é a enumeração exaustiva gerada. Como o catálogo é gerado, uma divergência entre os dois incrimina o README, e a correção é uma edição no README; o catálogo não pode ficar defasado.

## Alternativas consideradas

- **Renderização sintetizada por campo**: uma lista de marcadores, uma tabela ou um trecho de YAML anotado por campo, montado a partir do JSDoc interpretado mais os metadados do schema. Rejeitada em favor da colagem literal: a interface com seu JSDoc já é o contrato escrito em sua forma original, e um renderizador que sintetiza reformata prosa que não lhe pertence, acrescentando uma camada de renderização que pode deturpá-la.
- **Boot do runtime + introspecção de schema, como faz o catálogo de ferramentas**: rejeitada. Nada aqui é composto em tempo de execução, e o schema sozinho subdocumenta a superfície (padrões documentados em prosa, campos exclusivos de runtime, plugins sem schema nenhum). Fazer o boot acrescentaria fragilidade sem acrescentar verdade.
- **Igualdade bidirecional entre schema e interface**: rejeitada em favor da verificação de subconjunto. O tipo declarado carrega legitimamente membros que o schema se recusa a aceitar da configuração (seams exclusivos de runtime).
- **Aposentar as seções `## Config` dos READMEs na mesma mudança**: rejeitada. A duplicação aceita mantém o contrato por pacote legível no próprio lugar, e uma varredura teria antes de incorporar os fatos extras de cada README ao JSDoc dos campos, um trabalho separável do qual o catálogo não depende.

## Consequências

- O catálogo não pode ficar defasado: uma mudança no código-fonte que o arquivo versionado não reflete faz o `verify-config-catalog` falhar no `doc-sync` e na CI. Um campo de configuração sem documentação, um nome de tipo referenciado que não resolve ou uma chave de schema ausente do tipo de configuração fazem o gerador falhar de imediato.
- A prosa de configuração agora tem uma função de coerção na declaração: escrever um campo de configuração novo significa escrever seu JSDoc, que se torna literalmente a entrada do catálogo.
- O gerador gera erro fatal diante de estruturas que não consegue percorrer estaticamente: um import de configuração local do pacote com alias, um schema construído por qualquer coisa além da composição `object`/`intersect`, um nome de tipo global não listado. Introduzir uma estrutura dessas inclui ensinar o gerador (ou a estrutura fica fora do repositório), e esse é o propósito: o catálogo continua sendo a verdade inteira.
- O `gen-cordis-catalog.ts` exporta seus helpers de JSDoc/ponteiro e o `LINK_MAP` para reutilização, de modo que os dois catálogos fazem links cruzados de tipos de forma idêntica e uma adição ao mapa de links atende a ambos.
