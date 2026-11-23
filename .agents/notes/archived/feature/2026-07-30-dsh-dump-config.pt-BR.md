# Agent Note: dsh --dump-config imprime a árvore de configuração composta

Status: implemented
Archived: 2026-08-07

[English](2026-07-30-dsh-dump-config.md) | Português

## Problema

A árvore inicializada é uma composição que o usuário nunca vê: a base distribuída, um overlay de superfície e o overlay de `--config` ou o pessoal `~/.dsh/config.yaml` se aplicam como listas de patches irmãs, em que cada patch direcionado por id substitui o `config` inteiro da linha e um id sem correspondência gera apenas um aviso. Depurar um overlay pessoal com mau comportamento (um campo redeclarado que foi descartado, um erro de digitação no id de uma linha, um patch aplicado à superfície errada) exigia refazer mentalmente o algoritmo de patch ao longo de três arquivos. Não havia como ver a árvore efetiva nem como fazer o diff dela contra os padrões distribuídos.

## Decisão

`dsh --dump-config` e `dsh web --dump-config` imprimem a lista de entradas composta (base, overlay de superfície e depois o overlay de `--config` ou o pessoal, exatamente as camadas que a inicialização daquela superfície monta) como YAML no stdout e saem sem inicializar. `dsh --dump-default-config` / `dsh web --dump-default-config` param no overlay de superfície, de modo que o diff das duas saídas mostra precisamente o que a camada do usuário muda.

O dump não pode divergir do que é inicializado porque compartilha o código de montagem: o include vendorizado exporta seu algoritmo de patch como a função pura `applyEntryPatches(data, patches, warn)` (o método privado `applyPatches` agora delega a ela) e seu dialeto YAML `!!js` como `entryListSchema`; o `renderConfigDump()` de `dsh-app-boot` compõe camadas rotuladas e renderiza por meio dos dois, e `apps/cli/src/dump-config.ts` é um wrapper fino de seleção de superfície. As expressões `!!js` são impressas literalmente e sem avaliação, pois o dump mostra a composição, não o ambiente de um processo, e um patch cuja linha de destino está ausente vai para o stderr com o rótulo da camada dele, espelhando o aviso do Loader no momento da inicialização. Os valores de contexto de inicialização pertencentes ao launcher (identidade da sessão, patches de flags de CLI (interface de linha de comando) da web, o caminho do dist do frontend) são fatos de cada invocação, externos à árvore de configuração, e não aparecem. As flags de dump rejeitam as flags exclusivas de inicialização (`-p`, `--resume`, `--config-replace`) e uma à outra, e `--dump-default-config` não aceita `--config`.

Cada sequência de linhas de mesma proveniência é precedida por um comentário `# ==` que nomeia o arquivo que contribuiu com as linhas e as camadas que aplicaram patches a elas (`# == base.cordis.yml, patched by tui.cordis.yml`), de modo que a saída mostra qual seção vem de qual arquivo e continua sendo um único documento YAML carregável. A composição é uma única chamada achatada de `applyEntryPatches` sobre todas as camadas, com a forma exata da chamada da inicialização, de modo que até os casos extremos de visibilidade de patch (uma camada posterior que mira um filho de grupo introduzido por uma substituição simples de `config`, invisível ao índice de ids de passada única) se compõem de forma idêntica; aplicar uma chamada por camada reconstruiria o índice entre as camadas e imprimiria uma árvore que a inicialização nunca monta. A proveniência é derivada de snapshots de prefixo de chamada única (base + camadas 1..k) comparados posicionalmente: o algoritmo de patch só reescreve linhas no lugar ou acrescenta linhas ao final, então um índice de nível superior identifica uma mesma linha entre os snapshots, e considera-se que uma camada aplicou patch a uma linha quando a adição dessa camada mudou a linha (substituição de configuração, desativação, inserção em grupo). As listas de patches são clonadas a cada snapshot porque `applyEntryPatches` insere as linhas de `insert` por referência a partir da lista de patches.

O `dsh-app-boot` antes duplicava o tipo YAML `!!js` do include para o parsing de patches; agora ele importa `entryListSchema`, de modo que o dialeto tem um único dono.

## Alternativas consideradas

**Inicializar a árvore e fazer o dump de `ctx.loader.entries()`.** Rejeitada: inicializar avalia as expressões `!!js` (vazando o ambiente de uma máquina para a configuração impressa), inicia adaptadores e sessões como efeitos colaterais, exige um caminho de encerramento independente de TTY e é lento. O dump serve para depurar a composição, que é uma função pura dos arquivos.

**Reimplementar o merge de patches na CLI.** Rejeitada: uma segunda implementação de `applyPatches` divergiria silenciosamente do include vendorizado, exatamente o modo de falha que a funcionalidade existe para depurar. Exportar o próprio algoritmo do include custa uma modificação de vendor registrada e garante a identidade.

**Um comando de TUI `/dump-config` em vez de flags.** Rejeitada como única forma: o uso principal é um workflow no estilo `dsh --dump-config | diff - <(dsh --dump-default-config)` com pipe, que precisa de uma superfície sem TTY e sem inicialização. Um comando de TUI pode ser adicionado depois sobre o mesmo `renderConfigDump`.

## Consequências

A depuração de configuração passa a ser um comando, em vez de um replay mental de patches, e o suporte pode pedir a saída de `--dump-config`. O include vendorizado carrega mais uma modificação local registrada (as exportações `applyEntryPatches`/`entryListSchema`; preserva o comportamento da montagem) a ser reaplicada na sincronização com o upstream. O rastreamento de proveniência recompõe um snapshot de prefixo por camada e compara as linhas por JSON stringify, então o dump faz trabalho extra proporcional a camadas² × linhas; esse custo existe somente no caminho de dump sem inicialização. O `renderConfigDump` tem testes unitários para a ordenação das camadas, a ida e volta literal de `!!js`, os separadores e o agrupamento de proveniência, os avisos rotulados de patch sem correspondência e as falhas explícitas de leitura, de parsing e de formato; o e2e do binário construído exercita as quatro formas de flag por meio de `lib/bin.js`, incluindo a camada de overlay pessoal, o rótulo de proveniência dela e o aviso dela no stderr.
