# Agent Note: `dsh migrate`/`dsh upgrade` iniciam o primeiro turno com uma skill

Status: implemented
Archived: 2026-08-03

[English](2026-07-28-dsh-guided-skill-session-commands.md) | Português

## Problema

Dois fluxos recorrentes começam com o usuário invocando manualmente uma skill (habilidade) e respondendo às perguntas dela: migrar de outro coding agent (agente de programação) e atualizar este checkout. Ambos exigem que o usuário saiba que a skill existe e digite `/skill:dsh-migrate` ou `/skill:dsh-upgrade` como primeiro turno da sessão. Um comando de entrada dedicado, que leva o usuário direto a essa sessão guiada, elimina a etapa de descoberta.

## Decisão

`dsh migrate` e `dsh upgrade` fazem o boot da TUI comum como uma sessão nova cujo primeiro turno invoca automaticamente uma skill empacotada (`dsh-migrate`, `dsh-upgrade`), exatamente como se o usuário tivesse digitado `/skill:<name>` e pressionado Enter.

A semente reutiliza o caminho de skill que já existe na TUI, não um novo. `createTuiChat` já tem `invokeSkill(name, instructions)`, o código que um `/skill:<name>` digitado executa, incluindo o aviso "Unknown skill". O launcher passa o nome da skill para a TUI por um novo slot do contexto de boot, `INITIAL_SKILL_KEY` (`tuiInitialSkill`), espelhando `CONFIGURED_AGENT_IDENTITIES_KEY`/`TUI_GOODBYE_MESSAGE_KEY`: `ctx.provide` é o único canal do argv do launcher para um plugin montado pelo Loader. O `apply()` da TUI lê o slot e o incorpora a `config.initialSkill`; depois que `ui.start()` conclui com sucesso, `createTuiChat` dispara `invokeSkill(config.initialSkill, '')` uma vez quando o valor está definido.

**O launcher, não a TUI, decide se a sessão é nova.** `runSkillSession` sempre cria uma sessão nova e fornece o slot apenas quando `resumeSessionId === undefined`, então um `dsh --resume <id>` posterior dessa sessão é uma sessão comum da TUI, sem reinjeção. A TUI continua genérica: invoca a skill que receber, uma vez, na inicialização.

**`migrate`/`upgrade` não aceitam opções da superfície padrão** (`upgrade` carrega adicionalmente o `--experimental` do [gate experimental](2026-07-31-experimental-subcommand-gate.md)). Eles não carregam `--resume`, `--config` nem `-p`; uma entrada guiada de sessão nova não tem o que retomar nem reconfigurar. Qualquer opção da superfície padrão que vaze falha de forma explícita, seguindo o padrão de rejeição de `web`/`meta` no adaptador Commander. Os dois modos compartilham um único discriminante `SkillSessionInvocation` (`mode: 'migrate' | 'upgrade'`); o `bin.ts` mapeia o modo para `dsh-${mode}`.

A skill `dsh-migrate` é empacotada em `skills/` (distribuída por `DSH_BUNDLED_SKILL_DIR`, como `dsh-upgrade`). Ela pergunta qual é o agent de origem (opencode/pi/Claude Code/Codex) se isso não foi informado e depois mapeia cada capacidade (instruções de workspace, overlay pessoal, skills, hooks, MCP, API/env) para o equivalente no DSH, com base nas superfícies reais do repositório (as pontes `hooks-claude`/`hooks-codex`, `~/.dsh/{config.yaml,.env,AGENTS.md,skills/}`, `AGENTS.md`/`CLAUDE.md`, `mcporter`), e declara com clareza quando uma capacidade não tem equivalente.

## Testes

`apps/cli/tests/args.spec.ts` ganha o roteamento de `migrate`/`upgrade` (discriminante simples) e exit 1 para toda opção vazada de qualquer um dos lados de cada subcomando.

`packages/ui/tui/tests/tui.spec.ts` ganha dois casos com terminal falso no bloco describe de skill existente: `config.initialSkill` definido entrega o corpo renderizado da skill como primeiro turno, sem entrada do usuário, e uma skill inicial desconhecida relata um aviso sem enviar. O próprio `runSkillSession` é composição dentro do bloco `v8 ignore` do módulo, como `runTui`/`runMeta`.

Não há snapshot PTY sem chave: conforme a decisão de escopo da manutenção para esta mudança, a cobertura unitária mais a verificação interativa bastam, e a semente passa pelo caminho de renderização de `/skill:`, que já tem snapshot. Os dois comandos foram verificados interativamente no tmux a partir de um cwd descartável: `dsh migrate` carregou `dsh-migrate` e perguntou qual era o agent de origem; `dsh upgrade` carregou `dsh-upgrade`, que trouxe `dsh-customize` e iniciou a descoberta do checkout.

## Alternativas consideradas

**Preencher a entrada e deixar o usuário pressionar Enter.** Rejeitada: precisa de um novo seam de preenchimento do editor e ainda exige uma tecla. O envio automático reutiliza `invokeSkill` e entrega a entrada pretendida, de um só comando.

**Usar como semente uma instrução em linguagem natural ("use the dsh-migrate skill…") em vez de `/skill:<name>`.** Rejeitada aqui: o caminho literal de invocação de skill renderiza o corpo da skill no primeiro turno de forma determinística, idêntica ao comando manual, em vez de depender de o modelo escolher carregar a skill.

**Dar suporte a `--resume` em `migrate`/`upgrade`.** Rejeitada: são entradas guiadas de uso único. Uma sessão retomada é uma sessão comum da TUI, alcançável pelo `dsh --resume <id>` da superfície padrão; reinjetar a skill na retomada duplicaria o primeiro turno.

**Ler `INITIAL_SKILL_KEY` fora da TUI (como `CONFIGURED_AGENT_IDENTITIES_KEY` é lido pelo `agent-loop`) em vez de no `apply()` da TUI.** Desnecessário: `initialSkill` é um campo da `Config` da TUI consumido em `createTuiChat`, então incorporar o slot à configuração na entrada da TUI o mantém ao lado das outras leituras de runtime que pertencem ao launcher (`tuiResumeHost`, `tuiGoodbyeMessage`) e não toca em nenhum outro plugin.

## Consequências

Migrar ou atualizar é um só comando a partir de qualquer lugar, com a skill guia já invocada. O slot de skill inicial launcher→TUI pode ser reutilizado por qualquer comando futuro de sessão guiada; o contrato da TUI é "invocar esta skill nomeada uma vez na inicialização", e a política de sessão nova/retomada fica com o launcher, que é dono da identidade da sessão. O [comando de barra de skill da TUI](2026-07-21-tui-skill-slash-command.md) continua sendo o mecanismo; esta nota acrescenta uma invocação automática dele acionada pelo launcher e não o substitui.
