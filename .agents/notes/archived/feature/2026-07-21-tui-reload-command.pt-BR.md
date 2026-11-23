# Agent Note: O comando /reload relê as configurações do loader sob demanda

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-reload-command.md) | Português

## Problema

O observador de arquivos do HMR (Hot Module Replacement) só reage a eventos `change` feitos no próprio arquivo, sob as raízes configuradas (o diretório da folha de configuração nas demos entregues). Editores que substituem arquivos por rename (`sed -i` do BSD, `git checkout`) não produzem evento algum, e runtimes sem a entrada do HMR não têm nenhum caminho de recarga de configuração. Durante o desenvolvimento, isso significa reiniciar a TUI para aplicar uma edição de configuração que o observador perdeu. Ampliar as raízes observadas para o repositório inteiro foi considerado e rejeitado em discussão: o compartilhamento denso de pacotes faz do HMR em nível de módulo uma operação que remonta a maior parte da árvore, com fronteiras de externals imprevisíveis.

## Decisão

O `dsh-tui` ganha um comando de barra `/reload` **experimental e apenas para desenvolvimento**: ele percorre `ctx.loader.entries()` e chama `refresh()` em cada subárvore apoiada em arquivo (`Include`), ou seja, exatamente o caminho de código que o ramo de mudança de configuração do observador do HMR aciona, só que invocado manualmente e sem depender do observador. Arquivos inalterados não geram operação alguma (comparação de conteúdo em `Include.read`); arquivos inválidos emitem um aviso e mantêm a árvore em execução (o contrato de resiliência do hot reload); os `patches` de include, incluindo o overlay pessoal da CLI (interface de linha de comando) dsh, são reaplicados a cada releitura.

A TUI alcança o Loader **estruturalmente** (`ctx.loader` por meio de um tipo local, não de `inject`): testes e aplicações que embutem a TUI a executam sem Loader, e nesse caso `/reload` degrada para um aviso em vez de fazer a montagem falhar. O hot reload do código-fonte dos módulos continua sob responsabilidade do observador; `/reload` atualiza apenas configurações.

## Alternativas consideradas

**Ampliar as raízes observadas pelo HMR para `packages/`/`apps/`.** Rejeitado por enquanto: mudanças no código-fonte de um plugin recarregam o fiber de todo plugin dependente, e os pacotes compartilhados densos do repositório (`dsh-session`, `dsh-llm`, `dsh-tools`) fazem disso uma desmontagem da espinha dorsal e da UI no meio da sessão: um reinício disfarçado, com os riscos de uma recarga parcial. Um comando manual com escopo de configuração captura o subconjunto seguro e previsível.

**Declarar `loader` em `inject`.** Rejeitado: isso tornaria o Loader uma dependência obrigatória da TUI e quebraria toda composição sem Loader (harness de testes unitários, aplicações que a embutem) por uma conveniência de desenvolvimento.

**Uma ferramenta `cordis_reload` voltada ao modelo em dsh-tool-cordis.** Rejeitado: esta é uma ação de operador para a pessoa que está no terminal, não uma capacidade que o modelo deva acionar; a superfície de mount/unmount do conjunto de ferramentas cordis já cobre o que o modelo precisa para modificar o runtime.

## Consequências

- `/reload` aparece na linha de ajuda, no autocompletar (marcado como EXPERIMENTAL (dev)) e nos dois snapshots de renderização da ajuda (regravados).
- O comando informa a contagem de árvores e a conclusão como avisos no transcript (registro textual da sessão); as falhas por arquivo aparecem apenas nos logs do loader, que a TUI não exibe: aceitável para uma superfície apenas de desenvolvimento, e registrado na mensagem de conclusão.
- Uma guarda de reentrância serializa as recargas: um `/reload` disparado enquanto outro está em andamento é recusado com um aviso, o que mantém com um único escritor a passagem de atualização de árvore do loader, que não tem mutex; a guarda é liberada na conclusão ou na falha.
- `/reload` só roda enquanto o agent (agente) está ocioso: uma recarga pode fazer dispose (liberação de recursos) de entradas e montá-las de novo, o que, sob um turno ativo, poderia arrancar ferramentas ou o adaptador de chamadas em andamento. A verificação é apenas consultiva (um envio pode entrar em corrida logo depois dela), mas elimina a armadilha mais comum.
- Se o contrato de nunca rejeitar de `refresh()` mudar algum dia, o comando informa a falha em vez de deixar uma rejeição não tratada.

## Testes

`packages/ui/tui/tests/tui.spec.ts` fixa: `/reload` atualiza toda subárvore apoiada em arquivo e pula entradas simples (Loader falso estrutural), informa a conclusão, recusa a reentrada enquanto um refresh bloqueado está em andamento e roda de novo depois da liberação, libera a guarda no ramo de falha, recusa um agent em execução e roda de novo quando ele fica ocioso, informa um refresh que rejeita e degrada para um aviso sem Loader, inclusive montado como um fiber de plugin real, caso em que uma busca de serviço que lança exceção escaparia. Verificado ao vivo no tmux contra a árvore real: edição de sondagem → a recarga aplica; edição inválida → a recarga mantém a árvore em execução.
