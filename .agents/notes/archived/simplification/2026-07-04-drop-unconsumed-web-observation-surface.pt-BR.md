# Agent Note: Remover a superfície de observação da web sem consumidores — o evento `providers-change` e os métodos de status

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-drop-unconsumed-web-observation-surface.md) | Português

## Problema

`WebService` expõe uma superfície de observação que nenhum código de produção observa:

- **`web/providers-change`** (`packages/web/web/src/index.ts`) é declarado e emitido a cada registro e a cada dispose (liberação de recursos) de provedor, e o yield de rollback de cada efeito de registro é ordenado ANTES do emit unicamente para que um listener de mudança que lance exceção desfaça o registro. Não existe nenhum listener fora dos dois testes unitários do próprio pacote (um dos quais existe para fixar essa ordenação do rollback).
- **`searchStatus()` / `fetchStatus()` e a união `WebCapabilityStatus`** (mesmo pacote) têm zero chamadores em produção: `dsh-tool-web` executa diretamente por `ctx.web.search()`/`fetch()` e expõe a indisponibilidade como os códigos estruturados de `WebError` que o seam lança no momento da execução (`packages/web/tool-web/src/search.ts`, `packages/web/tool-web/src/fetch.ts`); os únicos chamadores de status são os testes dos próprios pacotes web. A prosa em `packages/web/tool-web/README.md` e em [architecture.md](../../../../docs/architecture.md) afirma que a ferramenta "reads only the aggregated `searchStatus()`/`fetchStatus()`", um desvio que só sobrevive porque nada confere a prosa com os pontos de chamada.

O próprio design do seam deixa as duas superfícies sem consumidores: o registro da ferramenta acompanha a HABILITAÇÃO do produto, não a disponibilidade de provedores (`packages/web/tool-web/src/index.ts`), e a seleção de provedor é resolvida no momento da execução, nunca guardada em cache. Logo, não há cache a invalidar, nem conjunto de registros a recalcular, nem chamador que precise de uma sondagem de disponibilidade distinta de executar e encaminhar o erro estruturado. A limpeza de HMR (Hot Module Replacement) fica a cargo dos próprios disposers dos efeitos.

Isso espelha [drop the unconsumed `llm/adapter-change` event](2026-06-20-drop-unconsumed-llm-adapter-change-event.md), que removeu de `LlmService` o mesmo formato de notificação, a mesma maquinaria de rollback antes do emit e o mesmo teste de listener que lança exceção. O critério de manter ou cortar daquela Agent Note (manter `tools/change` pelo seu consumidor plausível de lista de ferramentas voltada ao usuário, cortar o sinal de registry de backend do momento do boot) põe um registry de provedores web claramente do lado do corte; os métodos de status são o mesmo julgamento aplicado a uma superfície de pull em vez de uma de push.

## Decisão

Remover o evento de mudança do registry, os métodos e o tipo de status agregado e os testes dedicados a eles. O status privado do provedor permanece para a seleção no momento da execução. A cobertura voltada a quem chama agora verifica a execução bem-sucedida ou os erros estruturados de seleção, e os docs do pacote web responsável descrevem esse contrato válido no momento da chamada.

## Alternativas consideradas

### Por que não manter?

A Agent Note do seam de web especificou os dois deliberadamente (o evento como um sinal mínimo de visibilidade para HMR, os métodos de status como os diagnósticos agregados da ferramenta), e um futuro painel de status de provedores é imaginável. Mas as outras escolhas da mesma Agent Note os deixaram sem consumidores: a seleção derivada a cada chamada e o registro baseado em habilitação não deixam nenhum consumidor que POSSA precisar de qualquer um deles, a ferramenta distribuída demonstra o padrão real (executar e encaminhar o erro estruturado), e a frase desviada do README mostra que o consumidor prometido nunca se materializou. Conforme o AGENTS.md, "Agent Notes are proposals, not golden truth": estas são as partes daquela proposta que o código mostrou, desde então, irem longe demais; um futuro observador reintroduz o menor sinal ou a menor consulta que de fato consumir, moldados por esse consumidor.

## Verificação

Nenhuma grafia de `providers-change`, `searchStatus`, `fetchStatus` ou `WebCapabilityStatus` sobrevive fora do histórico de Agent Notes; o catálogo está atualizado (`verify-cordis-catalog` verde); os testes de segurança de HMR no registro e no dispose provam a limpeza pelo comportamento de execução; e o README do tool-web, junto com o parágrafo de arquitetura, descreve o contrato de encaminhamento de erros no momento da execução que a ferramenta realmente tem.

## Consequências

Uma futura UI de seleção de provedor ou um painel de diagnósticos que queira notificações de mudança ou uma consulta de status readiciona a menor superfície que consumir; o julgamento idêntico, e a condição que o reverte, já está registrado no precedente do llm.
