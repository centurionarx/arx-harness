# Agent Note: Execução nativa do código-fonte TypeScript para o dsh

Status: implemented
Archived: 2026-08-07

[English](2026-07-28-dsh-native-typescript-source-launch.md) | Português

> O vetor de execução nativo do Node foi substituído por [dsh source launch through the tsx ESM hook](2026-07-29-dsh-source-launch-tsx-esm.md): o Node 26.0.0 removeu `--experimental-transform-types`, e o loader de paths descrito aqui foi excluído. A gate de declaração da configuração do Cordis (`verify-cordis-config`), o diagnóstico de plugin com falha ruidosa no app-boot e as marcações `import type` no código vendorizado continuam valendo.

## Problema

O ponto de entrada de código-fonte do `dsh` usava originalmente o `tsx` para executar `apps/cli/src/bin.ts`, e esse mesmo loader de terceiros cuidava implicitamente tanto da transformação de TypeScript quanto da resolução dos `paths` do tsconfig raiz. Quando o Node trata TypeScript de forma nativa, ele não aplica os mapeamentos de caminho do tsconfig; resolver pelos exports dos pacotes, por sua vez, misturaria à execução a partir do código-fonte artefatos `lib/` possivelmente desatualizados ou inexistentes.

A transformação do Node também não faz análise de tipos. Um tipo importado por um import de valor comum continua sendo uma requisição ESM em tempo de execução, e o `export =` do TypeScript vira uma atribuição CommonJS em vez de um export default ESM. Por isso o grafo de código-fonte precisa usar imports explícitos somente de tipo e exports ESM nativos; um hook de resolução não consegue consertar sintaxe de código-fonte incompatível.

A configuração do Cordis introduz uma fronteira de resolução separada. Plugins bare em `cordis.yml` não passam pela análise de imports do TypeScript, então o manifest (lista de metadados) do resolver deles pode omitir as dependências necessárias. O Loader do Cordis registra em log os erros de import de plugin e deixa a entrada sem fiber, mas não faz a inicialização falhar por conta própria; um erro de digitação na configuração pode, portanto, produzir uma aplicação incompleta com código de saída 0.

## Decisão

As execuções a partir do código-fonte do `dsh` para TUI, Web e headless usam `node --experimental-transform-types`; o Node faz a transformação de TypeScript sem carregar o `tsx` nem o esbuild. `bin/dsh`, as demos `dsh`/TUI/Web no nível da raiz e o Code Mode TUI entram na mesma cadeia de execução de `apps/cli/src/bin.ts`. Os launchers de teste e de E2E mantêm suas estratégias atuais, e o `lib/bin.js` gerado pelo build continua rodando sob o Node comum.

`scripts/tspath-loader.ts` registra apenas um hook de resolução de módulos. Ele usa `TSX_TSCONFIG_PATH` quando definido (resolvendo valores relativos a partir do cwd de quem invoca) e, caso contrário, lê o `tsconfig.json` raiz; o `TsconfigPathsResolver` segue a cadeia de `extends` dessa configuração por meio da ferramenta de desenvolvimento TypeScript que o repositório já tem, seleciona entradas de `paths` exatas ou com curinga de acordo com as regras do tsconfig e mapeia os especificadores bare de workspace correspondentes para arquivos de código-fonte `.ts`/`.mts`/`.cts` ou para arquivos index de diretório. O Node continua sendo o único responsável pela transformação do código. O loader exclusivo de código-fonte não faz parte da CLI (interface de linha de comando) gerada pelo build, e `apps/cli` não declara `typescript` como dependência de runtime.

Os imports de código-fonte só são redirecionados quando o pacote de destino é o próprio nome do manifest de pacote mais próximo ou uma das dependências de runtime declaradas por esse manifest. O Loader do Cordis usa a URL do diretório de configuração como pai do import; o resolver então procura para cima o manifest de workspace que declara o plugin, de modo que a propriedade das dependências do `apps/cli/config/base.cordis.yml` distribuído, somado ao overlay da superfície, cabe a `apps/cli/package.json`. Especificadores que não casam com os paths do tsconfig, que se referem a dependências não declaradas ou que não são bare recaem todos na resolução padrão do Node.

`verify-cordis-config` faz uma verificação de completude de mão única sobre o manifest do resolver: todo pacote de plugin bare em uma configuração precisa aparecer nas `dependencies` do manifest correspondente, enquanto o manifest pode conter dependências extras que essa configuração não referencia. O `AGENTS.md` raiz torna regra permanente atualizar a configuração e as dependências em conjunto.

Depois que o Loader se estabiliza, o `dsh-app-boot` compartilhado verifica toda entrada habilitada que não tem fiber e rejeita a inicialização com `plugin(s) failed to load: ...; Cordis startup failed because these plugin(s) could not be resolved`, listando todos os plugins que falharam. Esse diagnóstico vive na camada de aplicação e não altera o comportamento de inicialização do Loader vendorizado.

TypeScript compatível com o Node faz parte deste contrato de execução a partir do código-fonte. Cordis, Loader, Include, HMR (Hot Module Replacement) e Schemastery vendorizados marcam os imports apagados com `import type`. O Schemastery usa um export default ESM nativo e declara `type: module`; suas saídas de build `.mjs` e `.cjs` mantêm o comportamento atual de default ESM e de `require()` chamável. Essas divergências estão registradas em `vendor/README.md`; nenhum comportamento de runtime é acrescentado aos frameworks vendorizados.

## Alternativas consideradas

**Continuar usando o `tsx`.** Rejeitada porque o `tsx`/esbuild continuaria sendo o dono da transformação de TypeScript, de modo que esta cadeia de execução não conseguiria provar que a transformação nativa do Node funciona.

**Carregar o `lib/` gerado pelo build pelos exports dos pacotes a partir do ponto de entrada de código-fonte.** Rejeitada porque isso misturaria o plano de código-fonte com o plano de artefatos; uma execução de desenvolvimento sem build poderia ler artefatos desatualizados ou falhar de vez.

**Aplicar os `paths` do tsconfig raiz incondicionalmente.** Rejeitada porque isso permitiria que imports entre pacotes não declarados e plugins do Cordis continuassem resolvendo, escondendo divergências entre o manifest e o grafo real de runtime.

**Transformar os imports dentro do loader customizado.** Rejeitada porque a reescrita de código-fonte com conhecimento de tipos reintroduziria uma transformação no estilo de compilador e tornaria o loader, em vez do Node, responsável pela execução de TypeScript. Tornar compatível com o Node o código-fonte versionado mantém explícita a fronteira de execução.

## Consequências

- TUI/headless mantêm um ciclo de código-fonte sem build, enquanto a Web ainda faz o build de seus artefatos de frontend antes de iniciar o ponto de entrada de código-fonte da CLI. A sintaxe TypeScript passa apenas pela transformação nativa do Node; o loader que só trata URLs usa as dependências de desenvolvimento da raiz do checkout e não acrescenta nenhuma dependência de runtime à CLI.
- Tanto os imports de pacotes do workspace quanto as dependências da configuração do Cordis precisam ser declarados explicitamente no manifest do resolver; a gate estática impede que a configuração entre antes de suas dependências, enquanto dependências extras não são erros.
- Falhas de import de plugin não deixam mais uma aplicação incompleta com código de saída 0; o erro final identifica tanto a falha de inicialização do Cordis quanto os nomes específicos dos plugins, enquanto o erro original do Loader permanece antes disso nos logs.
- O código-fonte vendorizado no grafo da CLI precisa continuar compatível com a semântica de módulos do transform-types do Node; o log de modificações locais torna explícita a obrigação de sincronização com o upstream.
- O modo `lib` da CI, os launchers de teste/E2E e os outros launchers de exemplo mantêm suas estratégias atuais; este loader nativo de código-fonte cobre apenas a cadeia da aplicação CLI `dsh`.
