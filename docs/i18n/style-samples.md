# Amostras de estilo (style samples)

Este arquivo é a âncora de calibração do estilo de tradução: cada amostra reúne um trecho original em inglês e a tradução em português definida como padrão ouro em revisão humana, cobrindo os principais gêneros de documento deste repositório. **O estilo de uma tradução se decide por estas amostras**: a amostra de gênero prevalece sobre qualquer descrição textual do tom, mas a tabela de terminologia, a fidelidade e as regras de estrutura continuam acima dela. Ao traduzir ou revisar, compare com a amostra de gênero mais próxima. Este arquivo é bilíngue por construção, com o inglês e o português lado a lado, e não participa do pareamento (veja a lista de exclusões em [README.md](README.md)).

Manutenção: quando a revisão humana calibra um novo trecho padrão ouro, acrescente-o ao gênero correspondente; erros de sentido, de estrutura ou de terminologia são corrigidos aqui mesmo. Toda amostra nova ou corrigida passa por revisão de PR (Pull Request).

## ① Narrativa de arquitetura

> This document describes the architecture of the arx Harness. The governing principle, from the microkernel design discussion: **everything is a plugin**. The core is deliberately tiny — a handful of abstract services plus one concrete loop plugin (`arx-agent-loop`) — and every product feature is a plugin against the extension API described here, without modifying the loop.

Este documento descreve a arquitetura do arx Harness. O princípio que a rege, vindo da discussão de projeto do microkernel: **tudo é plugin**. O núcleo é deliberadamente minúsculo, com um punhado de serviços abstratos e um único plugin concreto de loop (`arx-agent-loop`); toda funcionalidade de produto é um plugin escrito sobre a API de extensão descrita aqui, sem alterar o loop.

> Dependency rule: extension plugins depend on interfaces, never on `arx-agent-loop` (the loop is swappable); the sanctioned exception is the composition bundle `arx-agent-spine-demo`, whose job is assembling the concrete spine.

Regra de dependência: os plugins de extensão dependem de interfaces, nunca de `arx-agent-loop` (o loop é substituível); a única exceção autorizada é o bundle de composição `arx-agent-spine-demo`, cuja função é montar a espinha dorsal concreta.

> This document covers **behavior**; type definitions live in [subsystems/](../subsystems/core.md), the per-event/service reference lives in the generated regions of [subsystems/](../subsystems/core.md), and package contracts in the package READMEs state each package's required configuration and behavior ([map](../../packages/README.md)).

Este documento trata do **comportamento**; as definições de tipo ficam em [subsystems/](../subsystems/core.md), a referência por evento e por serviço fica nas regiões geradas de [subsystems/](../subsystems/core.md), e os contratos de pacote nos READMEs de cada pacote declaram a configuração e o comportamento que aquele pacote exige ([mapa](../../packages/README.md)).

## ② Regras de padrões defensivos

> Hard-won bug-class rules: each pattern below is a class of defect that actually shipped or nearly shipped here, stated as the rule that prevents its recurrence. Read this before writing lifecycle, concurrency, subprocess, or teardown code.

Regras de classes de bug aprendidas na prática: cada padrão abaixo é uma classe de defeito que chegou a ser publicada aqui, ou quase chegou, enunciada como a regra que impede a reincidência. Leia este documento antes de escrever código de ciclo de vida, concorrência, subprocesso ou teardown.

> **Dispose must reach quiescence, not just request it** — A teardown that issues kills/aborts but returns before the work stops leaves orphans. Make cleanup async and await the children's exit (kill → await `done`), and close listener/notification registries BEFORE killing so late completions stay silent. Tests prove disposal waited (pid gone right after `await fiber.dispose()`), not merely that the process eventually dies.

**O dispose (liberação de recursos) precisa alcançar a parada completa, não apenas pedi-la**: um teardown que dispara kills e aborts, mas retorna antes de o trabalho parar, deixa órfãos. Faça a limpeza assíncrona e espere a saída dos filhos (kill → await `done`); feche os registries de listener e de notificação ANTES de matar, para que as conclusões atrasadas não avisem ninguém. Os testes provam que a liberação de recursos esperou (o pid some logo depois de `await fiber.dispose()`), não apenas que o processo morre em algum momento.

> **Async state is not synchronous state** — `agent.followup()` does not flip status before returning; a background job's completion races turn boundaries; `reader.close()` fires for both EOF and disposal. Never gate control flow on a status you only just requested — drive lifecycle off the events/promises that actually fire (`agent/status`, `task.done`), and observe the transition (saw `running` THEN `idle`) instead of treating status as a per-follow-up result: several queued follow-ups run as consecutive turns under one `running` interval, while cancellation or disposal can discard unstarted items.

**Estado assíncrono não é estado síncrono**: `agent.followup()` não vira o status antes de retornar; a conclusão de uma tarefa em segundo plano corre contra as fronteiras de turno; `reader.close()` dispara tanto no EOF quanto na liberação de recursos. Nunca condicione o fluxo de controle a um status que você acabou de solicitar: conduza o ciclo de vida pelos eventos e pelas promises que de fato disparam (`agent/status`, `task.done`) e observe a transição (viu `running` e DEPOIS `idle`), em vez de tratar o status como resultado de cada follow-up. Vários follow-ups enfileirados rodam como turnos consecutivos dentro de um mesmo intervalo `running`, enquanto o cancelamento ou a liberação de recursos pode descartar itens que ainda nem começaram.

## ③ Lista da política de testes

> **Coverage gate** (`pnpm run test:coverage`): the gating run, per-file 100% on `packages/*/*/src`. An uncovered line is often dead code the gate is correctly flagging for deletion, not a missing test to bolt on. Line coverage is necessary, never sufficient — it proves lines ran, not that the feature works as shipped.

**A gate de cobertura** (`pnpm run test:coverage`): é a execução bloqueante, com 100% por arquivo em `packages/*/*/src`. Uma linha sem cobertura costuma ser código morto que a gate está corretamente apontando para exclusão, e não um teste que faltou pendurar ali. A cobertura de linhas é necessária, mas nunca suficiente: ela prova que as linhas executaram, não que a funcionalidade funciona como foi publicada.

> We are Centurionarx — do not ration real-API tests. A no-key test proves the plumbing; only a with-key run proves the agent works against a real model. Write many: real prompts that write files, multi-turn conversations, tool use, cancellation mid-stream. Cheapest and highest-value are **smoke tests** that boot the real example, send one real prompt, and check the world — they catch the "green unit tests, broken product" class that mocks structurally cannot. The self-skip exists only so secretless CI and keyless contributors aren't blocked; it is not a cost signal.

Nós somos a Centurionarx: não racione testes contra a API real. Um teste sem chave prova que as peças se conectam; só uma execução com chave prova que o agent (agente) funciona contra um modelo real. Escreva muitos: prompts reais que escrevem arquivos, conversas de vários turnos, uso de ferramentas, cancelamento no meio do stream.

Os mais baratos e de maior valor são os **testes de fumaça**, que sobem o exemplo real, enviam um prompt real e conferem o estado do mundo lá fora. Eles pegam a classe de falha "testes unitários verdes, produto quebrado" que os mocks, por construção, não têm como pegar.

O skip automático existe apenas para que o CI sem segredos e quem contribui sem chave não fiquem bloqueados; ele não é um sinal de custo.

> **Prefer the real implementation over a mock** — Mock only genuinely expensive or non-deterministic dependencies (the LLM adapter, the network, the clock); keep everything downstream real. A hand-rolled stand-in proves the bridge moves bytes, not that the shipping tool behaves as asserted — the two drift while the test stays green.

**Prefira a implementação real ao mock**: faça mock apenas das dependências realmente caras ou não determinísticas, como o adaptador de LLM (modelo de linguagem de grande porte), a rede e o relógio, e mantenha real tudo que vem depois delas. Um substituto escrito à mão prova que a ponte transporta bytes, não que a ferramenta publicada se comporta como o teste afirma: os dois divergem com o tempo enquanto o teste continua verde.

## ④ Descrição de mecanismo

> Blob hashes, not commit hashes, so the record is computable for files edited in the same PR (`git hash-object foo.md`) and consistency is a pure content comparison. The recorded hash also recovers the exact last-confirmed text of either side (`git cat-file -p <hash>`), so an out-of-sync pair is updated by diffing the edited side against its last-confirmed state and patching the counterpart minimally — never by re-translating whole files.

São blob hashes, não commit hashes: assim o registro é calculável para arquivos editados no próprio PR (`git hash-object foo.md`) e a consistência vira uma comparação pura de conteúdo. O hash registrado também recupera o texto exato da última confirmação de qualquer um dos lados (`git cat-file -p <hash>`), então um par fora de sincronia se atualiza comparando o lado editado com o último estado confirmado dele e aplicando o patch mínimo no counterpart, nunca retraduzindo o arquivo inteiro.

## ⑤ Declaração de política

> The gate's limit, stated plainly: a green gate means the pair was confirmed consistent at these exact contents, not that the confirmation was sound. It checks hashes and Markdown structure; it cannot judge whether the two sides actually say the same thing — that is the reviewer's half of the contract. A re-recorded pair with a sloppy counterpart passes the gate; it must not pass review.

O limite da gate, dito sem rodeios: uma gate verde significa que a consistência do par foi confirmada nesses conteúdos exatos, e não que a confirmação em si seja sólida. Ela verifica hashes e estrutura Markdown; não tem como julgar se os dois lados realmente dizem a mesma coisa, e essa é a metade do contrato que cabe a quem revisa. Um par cujo registro foi refeito com um counterpart malfeito passa na gate; ele não pode passar na revisão.

## ⑥ Argumentação em Agent Note

> Comparing git timestamps of the pair (no record) — rejected: formatting-only edits would false-positive, and a counterpart committed after an unrelated edit would false-negative; content identity is the only signal that means what the gate claims.

Comparar os timestamps do git dos dois lados, sem registro nenhum: rejeitado. Edições só de formatação dariam falso positivo, e um counterpart enviado em um commit posterior a uma edição sem relação daria falso negativo. Só a identidade de conteúdo é um sinal que significa aquilo que a gate afirma.

## ⑦ Requisito universal (demonstração de quebra de parágrafo longo)

> **Universal requirement**: every in-scope document merges as a complete bilingual pair. The manifest contains only explicit exclusions: it has no per-file rollout list, date cutoff, or README-specific policy class. […] Pairing is a continuing obligation: every later edit to either side updates the counterpart and consistency record in the same change.

**Requisito universal**: todo documento no escopo faz merge como um par bilíngue completo. O manifest (lista de metadados) contém apenas exclusões explícitas: não há lista de adoção arquivo a arquivo, data de corte nem categoria de política específica para READMEs.

[…] O pareamento é uma obrigação contínua: toda edição posterior em qualquer um dos lados atualiza o counterpart e o registro de consistência na mesma mudança.

## Pontos extraídos das amostras

- O estilo é o de um texto normativo: frases completas, tom assertivo; sem coloquialismo e sem academicismo.
- Dê à frase um sujeito explícito: as passivas vagas e os sujeitos abstratos do inglês viram o sistema, a gate, a ferramenta ou a revisão em português.
- Troque a tradução literal pela expressão consagrada da engenharia brasileira: false positive/false negative → falso positivo/falso negativo; ratchet → mecanismo que só aperta e nunca afrouxa; reviewable act → ato registrado que a revisão pode examinar.
- Localize a metáfora em vez de transplantá-la: bilingual from birth → exige os dois idiomas desde a criação; grandfathered → mantido por direito adquirido.
- Substantivos de categoria vão em português com a anotação em inglês na primeira ocorrência: manual prático (cookbook), compactação (compaction); quando a referência é a um diretório ou a um caminho, mantenha o inglês em code span.
- Quebre parágrafos longos por unidade semântica, uma ideia por parágrafo; abra as cadeias de substantivos do inglês em orações com verbo.
- Reescrever como nativo não é resumir: cada elemento de sentido do original precisa aparecer no counterpart.
- Quando uma amostra conflita com [terminology.md](terminology.md), a tabela de terminologia vence: corrija os termos antes de incorporar a amostra (por exemplo, agent, mock e LLM ficam em inglês, e cancellation vira cancelamento).
- Identificadores em code span (nomes de evento como `agent/status`, valores de estado como `running`, nomes de pacote como `arx-bash-local`) permanecem verbatim no counterpart; nunca os reescreva em prosa. O segundo passe confere isso frase a frase.
