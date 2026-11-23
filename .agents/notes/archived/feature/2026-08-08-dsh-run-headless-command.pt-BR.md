# Agent Note: `dsh run` é dono da execução headless de tarefa única

Status: implemented
Archived: 2026-08-10

[English](2026-08-08-dsh-run-headless-command.md) | Português

> **Gramática de comando substituída.** [As aplicações agora são donas de suas linhas de comando](../architecture/2026-08-06-app-owned-command-line.md): a linha de inicialização headless extrai a tarefa de `dsh --profile headless <task...>`, e o launcher não tem mais uma invocação `run` nem insere o texto da tarefa em linhas. Esta nota permanece como contexto do design rejeitado em que o launcher era o dono; o contrato de execução direta e de conclusão que ela escolheu continua atual em [headless é um ponto de entrada direto do core](../architecture/2026-08-09-headless-direct-core-entry-point.md).

## Problema

A inicialização genérica de perfil e a execução de tarefa única têm contratos de ciclo de vida diferentes. Uma gramática raiz que aceita texto de tarefa opcional faz um mesmo formato de argv significar ou um processo de longa duração ou uma tarefa que termina, conforme uma linha de plugin descoberta só depois da composição. Ela também expõe um detalhe de implementação de perfil como o comando principal do usuário e não dá aos perfis personalizados nenhuma entrada explícita de tarefa única.

O verbo `run` precisa ter um único significado no nível superior. Compartilhá-lo com a execução de arquivos de aplicação ou inferir seu significado a partir do formato posicional cria a mesma ambiguidade.

## Decisão

A execução de tarefa única é dona desta gramática:

```text
dsh run [--profile <name>] [--patch <path>...] <task...>
```

`--profile` tem `headless` como padrão e aceita composições personalizadas de tarefa única. `--patch` pode ser repetido e ocupa a camada normal de overlay. O Commander une os argumentos variádicos da tarefa com espaços e rejeita, antes da inicialização, uma tarefa ausente ou em branco.

`RunInvocation` é um membro distinto de `DshInvocation`. A invocação genérica de perfil não carrega estado de tarefa e não aceita argumentos posicionais. Os dois caminhos de despacho usam `runProfile`: a inicialização de perfil omite `task`, enquanto `run` a fornece. Um perfil de tarefa única sem `headless-runner` falha na verificação de linhas compostas, e uma inicialização de perfil que contém essa linha sem tarefa aponta para `dsh run --profile <name> "<task>"`.

A [decisão dos bundles de plugins de perfil](../architecture/2026-08-05-profile-plugin-bundles.md) é dona da composição. [Headless é um ponto de entrada direto do core](../architecture/2026-08-09-headless-direct-core-entry-point.md) é dona do contrato de execução: uma Session nova e persistida, o texto final do assistente no stdout, o mapeamento de saída entre concluído e não concluído, stderr vazio em caso de sucesso, nenhuma porta em escuta e um encerramento por sinal com prazo limitado, depois da parada completa do Agent e do flush da Session.

O verbo `run` pertence apenas à execução de tarefa única. A inicialização de arquivos de aplicação exige um nome de comando distinto.

## Alternativas consideradas

| Alternativa | Incompatibilidade de contrato |
|---|---|
| Colocar o texto da tarefa na inicialização raiz de perfil | O significado de ciclo de vida depende de uma linha de plugin descoberta depois do parsing. |
| Aceitar aliases na raiz, como `dsh -p` | A gramática de pré-lançamento ganha ramos de compatibilidade sem nenhum dono atual do comando. |
| Exigir `--profile headless` | A superfície de tarefa única entregue perde sua grafia canônica mais curta. |
| Usar `dsh run` para arquivos de aplicação | Um verbo de nível superior passa a ter dois significados, e o comando principal de tarefa se torna indireto. |
| Acrescentar um repassador raso `apps/cli/src/run.ts` | A posse do comando se divide sem esconder nenhuma complexidade. |

## Consequências

A ajuda, a documentação, os testes do parser, a aceitação do binário compilado, a cobertura de encerramento em PTY e o snapshot montado sem chave usam `dsh run`. Os perfis personalizados de tarefa única usam `--profile`; a inicialização de perfil de longa duração e os dumps de configuração mantêm a gramática raiz de perfil. A execução de arquivos de aplicação é assunto de um comando separado.
