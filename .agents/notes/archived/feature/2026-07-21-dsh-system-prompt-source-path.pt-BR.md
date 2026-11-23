# Agent Note: o dsh informa ao agent onde fica seu próprio código-fonte

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-dsh-system-prompt-source-path.md) | Português

## Problema

A CLI (interface de linha de comando) `dsh` é a superfície autorreferente: seu conjunto de ferramentas `cordis` permite que o agent (agente) inspecione e modifique o próprio runtime do harness em que ele roda. Mas o agent não tinha como descobrir onde esse código-fonte fica no disco. O `dsh` normalmente entra no PATH por um symlink e é iniciado a partir de um diretório de trabalho arbitrário, o projeto em que se está trabalhando, então nem o cwd nem o `argv` apontam de forma confiável para o checkout do harness. Sem o caminho, "leia seu próprio código-fonte" é adivinhação.

## Decisão

O launcher do `dsh` (`apps/cli/src/tui.ts`) calcula a raiz do checkout do harness a partir da URL de seu próprio módulo, `fileURLToPath(new URL('../../..', import.meta.url))`, três níveis acima de `apps/cli/{src,lib}`, de modo que ela resolve para a localização real do código-fonte independentemente de como o `dsh` é iniciado (um symlink no PATH, um cwd arbitrário). Depois que o `boot()` assenta a árvore, o launcher chama o novo helper `addHarnessSourceSection(ctx, sourceRoot)` do `dsh-app-boot`, que registra uma seção de prompt global `harness:source` com o texto `Your own source code is the checkout at <path>; you can read it there to learn how dsh works and how to extend it.` A seção é ordenada em `-99`, logo depois da abertura de identidade do harness (`-100`) e antes da persona do deploy (`0`).

A lógica testável vive no `dsh-app-boot`, não em `apps/cli`, porque `apps/*` não passam pela gate de cobertura e `packages/*` passam. Resolver o serviço opcional `systemPrompt`, registrar a seção e retornar o disposer pertencem ao lugar onde vale a cobertura de 100% por arquivo; o launcher fica só com a cola fina (calcular o caminho, chamar o helper), coberta pelo e2e de PTY da CLI. Quando a árvore inicializada não tem serviço `systemPrompt`, o helper é um no-op que retorna `undefined`.

## Escopo

Só a CLI `dsh` acrescenta isso. Os bins de demonstração (`dsh-cli-demo`, `dsh-acp-demo`) inicializam suas árvores versionadas literalmente e não ganham seção de código-fonte: eles não são a superfície de automodificação, e a raiz do checkout deles não é um fato de que o modelo precise.

## HMR

A seção é registrada na fiber do próprio serviço `systemPrompt` inicializado (por meio de `ctx.get('systemPrompt')`), então um reload de HMR (Hot Module Replacement) em desenvolvimento do plugin de prompt de sistema a descarta até o próximo boot. O HMR de produção observa a configuração, não o lib compilado, então esse é um detalhe exclusivo de desenvolvimento e aceitável.

## Alternativas consideradas

**Registrar a seção dentro do construtor do serviço de prompt de sistema.** Ela apareceria então em todo deploy, não só na CLI autorreferente, e a raiz do código-fonte teria de ser passada pela configuração até chegar ao construtor. O caminho é um fato do launcher, então cabe ao launcher injetá-lo.

**Manter tudo em `apps/cli/src/tui.ts`.** Os apps não passam pela gate de cobertura, então os ramos de registro e de serviço ausente seriam entregues sem teste. Extrair o helper testado para o `dsh-app-boot` mantém a gate significativa; a cola do launcher é exercitada pelo teste de fumaça de PTY sem chave da CLI.

**Adicionar um campo de configuração no cordis.yml para o caminho.** O caminho não é uma escolha de deploy: ele é, mecanicamente, a localização do próprio launcher. Um campo de configuração convida a um caminho desatualizado digitado à mão e acrescenta um ajuste sem variação legítima.

**Resolver a partir de `process.cwd()` ou `process.argv[1]`.** O cwd é o projeto do usuário, e um symlink no PATH faz de `argv[1]` o caminho do symlink; `import.meta.url` é a única referência à localização real do código-fonte.

## Consequências

O prompt de sistema do agent agora nomeia seu próprio checkout, então o conjunto de ferramentas `cordis` pode ler e editar o código-fonte do harness sem etapa de descoberta. O `dsh-app-boot` ganha uma dependência somente de tipos em relação ao `dsh-system-prompt` (peer + dev, igual ao import de tipos por efeito colateral do pacote acp) para o declaration merge de `ctx.get('systemPrompt')`; não há dependência em tempo de execução. A seção é texto visível ao modelo, fixado literalmente em um teste unitário do app-boot e verificado de ponta a ponta pelo teste de fumaça de PTY sem chave da CLI, que inicializa o `dsh` com a configuração roteirizada, executa um turno e lê o caminho de volta no prompt de sistema persistido em `request/header`. A linha fica antes do conteúdo por requisição, então não perturba o KV Cache entre turnos.
