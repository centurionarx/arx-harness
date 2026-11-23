# Agent Note: `dsh meta` inicializa a TUI sobre o checkout do harness

Status: implemented
Archived: 2026-08-03

[English](2026-07-28-dsh-meta-source-workspace.md) | Português

## Problema

O `dsh` trata o diretório de onde é invocado como o workspace, e é isso que o torna útil em projetos arbitrários. Trabalhar no próprio dsh significa, portanto, fazer `cd` até o checkout primeiro, e o checkout não é um caminho fácil de lembrar: a instalação a partir do código-fonte o mantém sob um diretório contêiner, como um worktree de staging com timestamp (`~/.dsh/source/staging-<timestamp>`) atrás de um symlink `current`, então o destino muda a cada atualização. O agent (agente) já é *informado* de onde fica seu código-fonte pela seção de prompt `harness:source`, e o conjunto de ferramentas `cordis` pode modificar esse runtime, mas o humano ainda precisava localizar o diretório à mão para iniciar uma sessão ali.

## Decisão

`dsh meta` inicializa a TUI comum com o checkout do harness como workspace, a partir de qualquer diretório.

O destino é `SOURCE_ROOT` em `apps/cli/src/tui.ts`, `fileURLToPath(new URL('../../..', import.meta.url))`, três níveis acima de `apps/cli/{src,lib}`: a mesma constante que a seção de prompt `harness:source` já nomeia, de modo que o workspace e o caminho anunciado ao modelo não podem divergir. Ela segue o caminho real do launcher, então um symlink no PATH que passa por `current` resolve para o worktree de staging que estiver ativo.

O mecanismo é um único `process.chdir(workspace)` dentro de `runTui`, protegido por um terceiro parâmetro opcional que só o despacho de `meta` passa. O cwd *é* o seam de workspace na árvore distribuída: `examples/tui-agent/cordis.yml` deriva dele o cwd da sessão (`!!js process.cwd()`), a raiz de persistência `./.sessions` e a raiz de observação do HMR (Hot Module Replacement) (`root: ['.']`), então um único chdir move os três juntos, e as sessões de meta vão parar no `.sessions/` do checkout, ignorado pelo git. Ele roda depois que as duas camadas de `.env` são carregadas (a carga do diretório de invocação feita pelo bin e a pessoal), então a precedência ambiente > projeto > pessoal fica intocada. `DEFAULT_CONFIG` e `SOURCE_ROOT` são absolutos, e o modo TUI não passa modo de snapshot, então a resolução da configuração independe do chdir.

`meta` sempre inicia uma sessão nova e não aceita opções da superfície padrão; sua única opção é o `--experimental` da [gate experimental](2026-07-31-experimental-subcommand-gate.md). `--config` inicializaria uma árvore alheia sobre o workspace do harness, o que é o caso do `--config` da superfície padrão, não deste comando; `-p` não é interativo, e a retomada reentra no workspace da própria sessão persistida por meio de `dsh --resume <id>`. Qualquer opção da superfície padrão que vaze falha de forma explícita.

## Testes

`apps/cli/tests/args.spec.ts` fixa o roteamento de `meta`, a rejeição de toda opção vazada da superfície padrão e a rejeição do antigo nome `experimental-meta`. O despacho em si é composição dentro do bloco `v8 ignore` já existente em `bin.ts`.

Não há teste de fumaça de PTY sem chave para esse modo. O harness de testes de fumaça dá a cada execução um cwd temporário, mas `dsh meta` deliberadamente faz chdir para o checkout real, então um teste de fumaça gravaria `.sessions/` na árvore viva no meio do teste. Cobri-lo direito exige um diretório de destino injetável, um seam exclusivo de teste que esta nota se recusa a adicionar por causa de um chdir de uma linha.

Em vez disso, o modo foi verificado interativamente. Iniciado a partir de `$HOME`, uma chamada da ferramenta `pwd` informa o checkout, o git resolve para o branch dele, o log da sessão vai parar sob o `.sessions/` do checkout (deixando `~/.sessions` intocado e a árvore livre de resíduos não ignorados), e o `dsh` puro a partir de outro diretório continua usando o diretório de invocação.

## Alternativas consideradas

**Passar um workspace explícito por `boot` e pela árvore de configuração.** Evita mutar estado de todo o processo, mas a configuração distribuída lê o cwd em três lugares (`!!js process.cwd()`, `persistenceRoot`, `root` do HMR), então cada um precisaria de seu próprio encanamento e de sua própria chave de configuração para permanecer consistente. O `chdir` antes do boot expressa "este é o workspace" uma única vez, no seam que já tem esse significado.

**Uma flag `--experimental-meta` na superfície padrão.** Rejeitada: a superfície padrão só tem opções para que os subcomandos não colidam com um posicional, e uma flag que realoca o workspace em silêncio é lida como um modificador do diretório atual, e não como um destino diferente. `meta` ao lado de `web` segue o formato existente.

**Resolver `~/.dsh/source/current` em vez do caminho do próprio launcher.** Rejeitada: divergiria do caminho do prompt `harness:source` sempre que o `bin/dsh` de um checkout não instalado fosse invocado diretamente, informando ao modelo uma raiz de código-fonte enquanto se trabalha em outra.

## Consequências

Iniciar uma sessão sobre o código-fonte do próprio dsh é `dsh meta --experimental` a partir de qualquer lugar (ou `dsh meta` puro sob `DSH_EXPERIMENTAL=1`), e o workspace é garantidamente o mesmo checkout de que o modelo é informado. O comando sempre começa do zero; um `dsh --resume <id>` comum restaura depois a sessão e entra em seu workspace persistido.

`runTui` ganha um terceiro parâmetro opcional, então a substituição do workspace fica visível na única função dona da composição da TUI, em vez de escondida em uma segunda cópia dela.
