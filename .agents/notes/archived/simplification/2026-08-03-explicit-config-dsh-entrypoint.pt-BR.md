# Agent Note: Entrypoint dsh com configuração explícita

Status: implemented
Archived: 2026-08-08

[English](2026-08-03-explicit-config-dsh-entrypoint.md) | Português

## Problema

O `dsh` sem argumentos selecionava implicitamente uma TUI de produto. Isso fazia um único comando ser dono do ciclo de vida do terminal, da identidade de sessão e do handoff de retomada, do onboarding, dos atalhos do workspace de código-fonte, das sessões guiadas de upgrade, da observação da configuração pessoal e de uma grande suíte de snapshots de PTY e de transcript (registro textual da sessão) no nível do app. O padrão também escondia a fronteira real de composição: `--config` era uma terceira camada opcional sobre um overlay de TUI, e não a definição de deploy de que um launcher bruto precisa.

A base compartilhada é intencionalmente neutra: ela fornece capacidades, mas não cria nenhum agent (agente) de inicialização nem porta de entrada de interação. Uma base neutra combinada com uma aplicação implícita tornava menos explícita a composição de configuração bruta e mantinha a política de produto na CLI (interface de linha de comando), e não no overlay selecionado por quem chama.

## Decisão

O uso bruto do executável é `dsh --config <path>`. O arquivo nomeado precisa ser uma lista de patches de Include e é aplicado diretamente sobre `apps/cli/config/base.cordis.yml`, no mesmo nível de include. Ele é obrigatório para o boot, não é uma árvore de substituição completa e não herda `apps/cli/config/web.cordis.yml` nem `$DSH_HOME/config.yaml`. Os caminhos relativos são resolvidos a partir do diretório de invocação. Os erros de boot falham de forma explícita; SIGINT e SIGTERM fazem o dispose (liberação de recursos) da raiz antes da saída.

As formas brutas de diagnóstico continuam sem boot: `dsh --dump-default-config` imprime a base, enquanto `dsh --config <path> --dump-config` imprime a base mais o overlay obrigatório. O dump usa o algoritmo de patch e o dialeto YAML da implementação de Include.

A CLI não entrega mais uma aplicação TUI. O overlay de TUI, o launcher, os assets de onboarding de primeira execução, as fixtures (dados de teste pré-montados) de TUI no nível do app, o harness de PTY, as jornadas de terminal e os snapshots dela foram excluídos. Os subcomandos `meta` e `upgrade`, a gate experimental deles, a retomada pela superfície padrão e o caminho `--config-replace` de árvore completa foram excluídos junto com essa aplicação. O instalador constrói e inicia a Web sem um seletor de interface.

`dsh web` mantém a base compartilhada mais o overlay da Web e a camada de usuário pessoal ou explícita. `dsh -p` mantém a composição Web/headless de execução única. O pacote TUI reutilizável inicialmente permaneceu depois desta mudança de entrypoint; depois, [a decisão de remoção do pacote inteiro](2026-08-04-remove-tui-package.md) o excluiu, junto com a interface de SDK dele.

Esta decisão substitui as partes específicas do `dsh` das notas [porta de entrada dedicada da TUI](../../archived/feature/2026-07-17-dedicated-full-screen-tui-front-door.md), [configuração pessoal](../feature/2026-07-20-dsh-cli-personal-config.md), [comandos guiados de skill](../../archived/feature/2026-07-28-dsh-guided-skill-session-commands.md), [workspace meta](../../archived/feature/2026-07-28-dsh-meta-source-workspace.md), [overlays de configuração compartilhada](2026-07-29-shared-base-config-overlays.md), [dump de configuração](../../archived/feature/2026-07-30-dsh-dump-config.md), [boas-vindas de primeira execução](../../archived/feature/2026-07-30-versioned-tui-first-run-welcome.md) e [gate de subcomandos experimentais](../../archived/feature/2026-07-31-experimental-subcommand-gate.md). A posterior [decisão de remoção do pacote inteiro](2026-08-04-remove-tui-package.md) substitui as decisões delas sobre o pacote reutilizável e consolida o registro excluído de identidade do launcher.

## Verificação

Os testes do parser exigem `--config` para o boot bruto e rejeitam os nomes de comando removidos e as combinações de opções incompatíveis. A aceitação do bin construído roda a entrada JavaScript publicada sem tsx, verifica os dumps só da base e da base mais overlay e conduz um overlay bruto de provedor inválido para provar que uma falha de boot se encerra e sai em vez de travar. A compatibilidade de execução a partir do código-fonte verifica o mesmo diagnóstico de configuração obrigatória por meio de `bin/dsh`. Não resta nenhum demo nem teste de TUI em `apps/cli`.

## Alternativas consideradas

**Manter o `dsh` sem argumentos como uma TUI e adicionar um subcomando de configuração explícita.** Rejeitada porque a CLI continuaria sendo dona de duas políticas de aplicação sem relação entre si e reteria o launcher, o onboarding e a infraestrutura de testes exclusivos da TUI.

**Permitir que o `dsh` sem argumentos faça o boot da base neutra.** Rejeitada porque a base não cria nenhum agent nem porta de entrada de interação. Um processo que se estabiliza com sucesso, mas não tem ponto de entrada utilizável, esconde uma decisão de deploy ausente.

**Manter `--config-replace` para árvores completas.** Rejeitada porque a execução bruta agora tem um único contrato de composição: um overlay obrigatório sobre a base do produto. Os deploys de árvore completa podem usar o loader genérico do Cordis ou um bin de aplicação dedicado sem acrescentar um segundo significado a `dsh --config`.

**Excluir o pacote TUI junto com o entrypoint de produto.** Inicialmente rejeitada porque remover uma aplicação entregue não exigia, por si só, remover uma implementação de UI reutilizável. Quando não restou nenhuma composição entregue nem consumidor independente, [a decisão de remoção do pacote inteiro](2026-08-04-remove-tui-package.md) aceitou esta alternativa.

## Consequências

Invocar `dsh` sem um modo ou sem configuração bruta é um erro de uso. As invocações existentes de inicialização da TUI, de `meta`, de `upgrade`, de retomada e de substituição de árvore completa param de funcionar, sem aliases de compatibilidade. Isso é aceitável sob a postura de compatibilidade de pré-lançamento e mantém pequena a gramática suportada.

Os deploys brutos precisam declarar suas linhas de agent e de porta de entrada em um overlay, o que torna a fronteira da aplicação revisável e mantém as atualizações da base disponíveis por baixo. Eles não recebem a configuração pessoal de forma implícita; os deploys que quiserem essa política precisam compô-la por conta própria. A Web continua sendo a superfície interativa de produto instalada, enquanto as entradas headless e de automação continuam separadas.

Reintroduzir uma aplicação de terminal entregue exige uma necessidade concreta de produto, um modo de entrada nomeado em vez de um padrão bruto implícito e sua própria superfície atual de aceitação de snapshot e de ciclo de vida.
