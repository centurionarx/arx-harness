# Agent Note: gravar cenários de snapshot de fork e de spawn+fork misto

Status: implemented
Archived: 2026-07-26

[English](2026-06-22-fork-snapshot-scenarios.md) | Português

## Problema

A [Agent Note da fronteira de seed](2026-06-22-fork-child-replay-seed-boundary.md) fez o replay do filho de fork ser roteado corretamente: `dsh-llm-replay` deriva o script de um filho a partir dos eventos situados na fronteira `seedLength` persistida ou depois dela, de modo que o prefixo do pai herdado por um filho de fork não é reproduzido como se fossem chamadas de modelo do próprio filho. Mas ela foi entregue **sem nenhum cenário de fork gravado**: o recorte era exercitado apenas pelos testes unitários de `llm-replay` (uma fixture sintética de filho) e por um teste de ida e volta de persistência. A camada de snapshot de transcript completo, a única rede que inicializa o `acp-agent` real e faz replay de um transcript aninhado de ponta a ponta, tinha apenas filhos de spawn (`subagent-spawn`, `subagent-multi`). Uma regressão no roteamento de fork que deixasse os testes unitários verdes ainda teria escapado da camada construída para capturar regressões de transcript.

A infraestrutura de snapshot para expressar um cenário de fork já estava pronta: os dois backends em processo estão ligados em `cordis.yml` / `cordis.snapshot.yml` como duas ferramentas voltadas ao modelo (`subagent` → spawn, `subagent_fork` → fork), o harness coleta o log de cada filho, e o replay encaminha fixtures por filho, indexadas por `seedLength`. O que faltava era um *cenário gravado* que conduzisse um filho de fork por ela.

## Decisão

Gravar dois cenários contra a API real, ambos reproduzidos sem chave na gate padrão:

- **`subagent-fork`** — o pai conclui um turno que estabelece um fato e depois delega uma subtarefa via `subagent_fork`. O filho de fork herda a conversa (o log dele carrega um `seedLength` diferente de zero), então consegue responder a partir do contexto do pai. Esta é a regressão focada: o `seedLength` da fixture do filho é a fronteira da qual o recorte do replay depende, gravada a partir de um fork real, e não sintetizada à mão.
- **`subagent-mixed`** — o pai conclui um turno e depois delega uma vez via `subagent` (um filho de spawn novo, `seedLength` 0) e uma vez via `subagent_fork` (um filho de fork, `seedLength` diferente de zero) em um só transcript. Este é o cenário misto de spawn+fork que as Agent Notes da fronteira de seed e do replay por sessão apontaram, ambas, como adição futura: um único transcript exercita os dois transportes e os dois ramos do recorte (`seedLength` 0 = sem efeito, `seedLength > 0` = aparar o prefixo herdado), com os dois filhos ordenados spawn e depois fork por `createdAt`.

### Por que um turno 1 concluído é necessário

O backend de fork alimenta o filho com o **prefixo balanceado de turnos concluídos** do pai. Um pai que faz fork logo no primeiro turno não tem turno concluído para deixar de herança, então o seed fica vazio (≡ um spawn novo, `seedLength` 0), o que NÃO exercitaria o recorte. Por isso os dois cenários usam uma entrada de dois prompts: o primeiro prompt conclui um turno (estabelecendo uma palavra-código que depois se pede ao filho para lembrar), e o segundo delega o fork. A palavra-código lembrada no transcript do filho é incidental ao comportamento do modelo; o artefato que sustenta o teste é o `seedLength` gravado na fixture do filho, que o recorte do replay consome.

## Consequências

- O recorte do roteamento de fork agora é protegido na camada de transcript completo, não apenas por testes unitários. Remover o `slice(seedLength)` (fazendo replay do log inteiro do filho) deixa **os dois** cenários novos vermelhos, porque o filho de fork recebe os chunks gravados do pai em vez dos seus, o que prova que a proteção funciona (verificado de vermelho para verde quando os cenários entraram).
- `subagent-mixed` é o primeiro cenário de snapshot a conduzir dois backends de subagent *diferentes* em um só transcript, exercitando a indexação do replay por sessão em um filho de spawn e em um filho de fork ao mesmo tempo.
- O replay de subagent fora do processo (ACP) continua tendo outro formato (cada filho é um processo próprio, com replay próprio) e segue rastreado como `TODO(acp-subagent-replay)`; estes cenários são apenas em processo.
- A regravação (`pnpm run test:snapshot:record`) regenera as quatro fixtures de fork/spawn a partir da API viva; os dois cenários novos se pulam sozinhos sem chave, como todo cenário gravado.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
