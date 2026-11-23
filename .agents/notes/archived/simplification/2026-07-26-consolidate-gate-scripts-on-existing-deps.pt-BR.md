# Agent Note: Consolidar os scripts de gate em dependências já presentes e em builtins

Status: implemented
Archived: 2026-07-27

[English](2026-07-26-consolidate-gate-scripts-on-existing-deps.md) | Português

## Problema

As gates em `scripts/` usavam, em sua maioria, as ferramentas certas (`globSync` de `node:fs` em mais de 15 gates, mdast/micromark nas gates de markdown), mas alguns retardatários implementavam à mão o que uma gate irmã já fazia com uma dependência existente ou com um builtin:

- **Scanners de cerca duplicados.** `scripts/md-fences.ts` (~55 linhas, consumido por `doc-typecheck.ts`) e `extractEquivBlocks` em `scripts/verify-type-equiv.ts` (~39 linhas) eram duas cópias do mesmo scanner de linhas por regex para blocos de código cercados, enquanto `scripts/verify-mermaid.ts` já extraía as cercas visitando os nós `code` do mdast — e `markdownProseLines` em `scripts/markdown.ts` fazia ele mesmo o parsing para mdast, mas depois acompanhava à mão o estado das cercas com uma segunda regex. Os scanners por regex só reconheciam cercas de crases na coluna 0, então discordavam em silêncio das gates baseadas em mdast quanto a cercas de til e cercas indentadas.
- **Parsing de argv feito à mão.** `parseOptions` em `scripts/publint-all.ts` e sua cópia quase idêntica em `scripts/verify-built-package-invariants.mjs` (~26 linhas) percorriam os índices de argv manualmente, enquanto scripts irmãos (`verify-runtime-closure.ts`, `build-exe-for-python-sdk.ts`, `packages/sdk/scripts/src/args.ts`) já usavam o builtin `parseArgs` de `node:util`.
- **Varreduras de diretório feitas à mão.** Cinco pontos reimplementavam varreduras aninhadas com `readdirSync` que `globSync` cobre: `verify-runtime-closure.ts` (pacotes + manifests de vendor), `discoverPluginDirs` em `dev-web.ts`, `realPackageNames` em `verify-package-paths.ts`, `listSources` em `verify-client-domain-graph.ts` e `addPath` em `publint-all.ts` (~55–65 linhas no total). `scripts/package-invariants.ts` mostra o modelo de uma linha com `globSync`.

Nenhuma dependência nova foi necessária em lugar algum; toda substituição é uma devDep existente ou um builtin do Node.

## Decisão

- Um helper compartilhado de cercas baseado em mdast, `markdownFences` em `scripts/markdown.ts`, visita os nós `code` para obter a linguagem, a info string completa, o corpo e a linha da cerca de abertura, contada a partir de 1; `doc-typecheck.ts` e `verify-type-equiv.ts` extraem as cercas por meio dele. `md-fences.ts` e o scanner duplicado `extractEquivBlocks` foram apagados, e `markdownProseLines` deriva as linhas cercadas das posições dos nós `code` já parseados, em vez de uma segunda regex.
- As duas CLIs fazem o parsing de argv via `parseArgs`; opções desconhecidas e valores ausentes ainda falham de forma ruidosa, com o texto de erro do próprio `parseArgs` no lugar das strings de uso sob medida.
- As cinco varreduras retardatárias usam `globSync`. As varreduras em `check-workspace-constraints.ts` e `clean.ts` ficam: elas precisam de detalhes no nível de dirent para diagnosticar árvores malformadas, o que um glob por padrão não consegue informar.

## Alternativas consideradas

- **Uma nova dependência de glob/varredura (`tinyglobby`, `fdir`).** Rejeitada: o builtin já venceu no repositório inteiro; estes eram retardatários, não uma lacuna.
- **`p-map` para o pool de workers ordenado de ~19 linhas de `publint-all.ts`.** Deixado de fora deliberadamente: uma devDep nova para uma única remoção pequena fica no limite do critério da [política de dependências](../process/2026-07-26-dependencies-over-hand-rolling.md), e os requisitos do pool (workers limitados, ordem determinística, override por variável de ambiente) estão documentados na [nota das gates paralelas](../process/2026-07-06-parallel-pre-push-gates.md). Incorpore-o só se `p-map` ganhar um segundo consumidor.
- **Deixar os scanners de cerca como estavam.** Rejeitado: duas cópias de um parser que divergem ao lado de uma terceira implementação correta são exatamente a duplicação que o helper compartilhado de `markdown.ts` existe para evitar, e a limitação a crases na coluna 0 era uma inconsistência latente entre gates irmãs.

## Consequências

- Um único parser de cercas: toda gate de markdown agora classifica as cercas por meio do mdast, de modo que cercas de til, cercas indentadas e cercas contêiner de 4 crases se comportam de forma idêntica em todo lugar. A árvore de docs não continha nenhum formato de cerca que os scanners por regex tratassem errado, então os resultados das gates não mudaram na árvore que recebeu a troca: `pnpm run doc-sync` e cada gate reescrita rodaram antes e depois com saída idêntica byte a byte (contagens de blocos/opt-out do `doc-typecheck`, contagens de correspondências do `verify-type-equiv`, `publint`, `verify-built-package-invariants`, `verify-runtime-closure`, `verify-package-paths`, `verify-client-domain-graph` e as duas gates de prosa dos READMEs de pacote).
- `verify-type-equiv` ainda rejeita uma cerca de equivalência de tipos não terminada: o mdast fecha em silêncio um bloco não terminado no fim do arquivo (as comparações dele poderiam então passar), então o helper compartilhado informa se existe um delimitador de fechamento e a gate acusa erro em um bloco não fechado, preservando a rejeição do scanner removido. O scanner do `doc-typecheck` nunca teve esse caminho de erro.
- `parseArgs` mantém o último valor de uma opção duplicada em vez de acusar erro — um caso de borda de ferramenta de desenvolvimento que os testes não fixam, aceito em troca de apagar os dois parsers sob medida. (O modo estrito ainda rejeita um token com prefixo `--` onde se espera um valor, como faziam os parsers substituídos.)
