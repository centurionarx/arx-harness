# Agent Note: subcomandos experimentais ficam atrás de `--experimental` ou `DSH_EXPERIMENTAL=1`

Status: implemented
Archived: 2026-08-03

[English](2026-07-31-experimental-subcommand-gate.md) | Português

## Problema

Os pontos de entrada `meta` e `upgrade` carregavam o status experimental no próprio nome: `dsh experimental-meta` e `dsh experimental-upgrade`. O prefixo deixava toda invocação verbosa, e renomear um comando na estabilização quebraria todas as referências a ele: memória muscular, scripts e documentação. O status pertence a uma gate de adesão explícita, não ao nome.

## Decisão

`dsh experimental-meta` passa a ser `dsh meta` e `dsh experimental-upgrade` passa a ser `dsh upgrade`. Cada um só roda quando a invocação passa a flag `--experimental` dele ou quando o ambiente carrega `DSH_EXPERIMENTAL=1`; caso contrário, o comando falha de forma explícita no stderr com código de saída 1, nomeando as duas formas de adesão. Conforme a postura de pré-lançamento, os nomes antigos deixaram de existir, sem aliases, e `args.spec.ts` fixa a rejeição deles.

A gate tem duas metades, cada uma com um único dono. A metade por invocação é uma opção `--experimental` do Commander em cada subcomando experimental, verificada dentro da ação dele depois da rejeição de opção do pai que vazou. A metade de ambiente é um parâmetro booleano de `parseDshArgs`: `bin.ts` lê `process.env.DSH_EXPERIMENTAL === '1'` na fronteira do processo (depois de `loadEnv`, para que um `.env` de projeto possa defini-la) e passa o resultado adiante, de modo que a dependência do parser em relação ao ambiente fica explícita na assinatura dele e os testes não precisam alterar o ambiente. `1` é o único valor que habilita: a variável é uma adesão explícita, não uma verificação de truthiness.

Estabilizar um comando mais tarde significa apagar a opção `--experimental` e a chamada `requireExperimental` dele; o nome não muda.

## Testes

`args.spec.ts` fixa os dois caminhos de admissão, a rejeição do nome sem adesão, a rejeição dos nomes antigos e a rejeição de opção vazada sob a adesão por ambiente. `built-bin.e2e.ts` prova a entrada montada de ponta a ponta: o diagnóstico da gate no stderr com código de saída 1, e que `--experimental` e `DSH_EXPERIMENTAL=1`, mas não `DSH_EXPERIMENTAL=0`, alcançam a recusa de stdio com pipe da TUI, a gate seguinte depois desta. Os dois comandos protegidos pela gate também foram verificados interativamente no tmux: `dsh meta --experimental` e `DSH_EXPERIMENTAL=1 dsh meta` inicializam a TUI sobre o checkout, e `DSH_EXPERIMENTAL=1 dsh upgrade` semeia a skill (habilidade) `dsh-upgrade`.

## Alternativas consideradas

**Manter o prefixo `experimental-` no nome.** Rejeitada por orientação do usuário: o prefixo onera toda invocação, e a estabilização seria uma renomeação incompatível em vez da remoção de uma gate.

**Uma flag `--experimental` no nível do pai (`dsh --experimental meta`).** Rejeitada: a superfície padrão é deliberadamente só de opções, com `enablePositionalOptions`, de modo que opções do pai que vazam pela fronteira do subcomando são tratadas como invocações digitadas errado. Uma flag do pai consumida por apenas dois subcomandos teria exatamente o formato de opção vazada que o adaptador rejeita em todos os outros lugares.

**Ler `process.env` dentro de `parseDshArgs`.** Rejeitada: o repositório valida na fronteira do processo e mantém puros os seams tipados; os testes teriam de alterar e restaurar `process.env` em torno de cada caso.

**Aceitar qualquer `DSH_EXPERIMENTAL` não vazio.** Rejeitada: a chave de telemetria prefere ficar desligada por engano, por ser um controle de privacidade, mas uma gate experimental é um reconhecimento explícito: `DSH_EXPERIMENTAL=0` não pode habilitar os comandos que ela nomeia.

## Consequências

As invocações do dia a dia encurtam para `dsh meta --experimental` e `dsh upgrade --experimental`, e um desenvolvedor que define `DSH_EXPERIMENTAL=1` no próprio ambiente obtém `dsh meta`/`dsh upgrade` sem a flag. O `dsh --help` marca os dois comandos com `(experimental)`. A gate custa uma flag ou uma variável de ambiente a mais até que um comando se estabilize, momento em que a gate é apagada e o nome já é o definitivo.
