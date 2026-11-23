# Agent Note: Remover o evento `llm/adapter-change` sem consumidor

Status: implemented
Archived: 2026-07-26

[English](2026-06-20-drop-unconsumed-llm-adapter-change-event.md) | Português

## Problema

`LlmService.registerAdapter()` emite `llm/adapter-change` no registro e no dispose (liberação de recursos) ([packages/llm/llm/src/index.ts](../../../../packages/llm/llm/src/index.ts)). Um grep por `llm/adapter-change` em `packages/*/src` e `examples/*/src` encontra apenas a declaração, os pontos de emissão, a documentação e os testes; nenhum listener de produção se inscreve nele.

Isso difere de `tools/change` e `system-prompt/change`. Esses dois eventos também não têm consumidor hoje, mas são sinais plausíveis de mudança de registry para futuras UIs que mostrem ferramentas/prompts ao vivo. O registro de adaptadores de LLM (modelo de linguagem de grande porte) é mais um detalhe de implementação do boot: os adaptadores não são uma paleta visível ao usuário, e o seam real de interceptação de chamadas ao modelo é `llm/stream`. Manter um evento de mudança de adaptador sem listener repete, em escala menor, o padrão de [remover o resumo morto](2026-06-19-drop-mutable-session-summary.md).

O evento não sai de graça. `registerAdapter()` entrega seu disposer de rollback antes de emitir `llm/adapter-change`, para que um listener que lance exceção desfaça a mutação em vez de deixar vazar uma entrada de adaptador, e o pacote carrega testes para esse caminho de exceção no listener. Essa ordenação defensiva protege um modo de falha que só os testes conseguem acionar.

## Decisão

Apenas `llm/adapter-change` é removido: a declaração na `interface Events` de `dsh-llm`, as chamadas `ctx.emit('llm/adapter-change')` e a frase "Emits `llm/adapter-change` on registration and disposal" no JSDoc de `LlmService.registerAdapter`. O gerador de efeito de `registerAdapter()` mantém a mutação e o disposer de rollback para HMR (Hot Module Replacement)/dispose, mas abandona a ordenação de rollback para exceção no listener, que existia só por causa do evento removido. O teste do disposer do adaptador verifica que o disposer retornado remove o adaptador sem se inscrever no evento; o teste de rollback para exceção no listener sai junto com o que ele testava. A taxonomia de eventos em [docs/architecture.md](../../../../docs/architecture.md) e em [packages/llm/llm/README.md](../../../../packages/llm/llm/README.md) é atualizada na mesma mudança.

## Alternativas consideradas

### Por que não remover todos os eventos de mudança de registry?

Um microkernel em que os registries anunciam mutações é uma convenção coerente. `tools/change` e `system-prompt/change` podem se tornar úteis quando uma UI conseguir atualizar ao vivo as ferramentas ou as seções de prompt disponíveis. Esta Agent Note deixa essa convenção intacta onde ela tem um consumidor plausível voltado ao usuário e corta apenas o evento de mudança de adaptador, cujo consumidor atual e provável consumidor futuro não estão claros.

Se um navegador de adaptadores de LLM ou um seletor dinâmico de modelos precisar desse sinal mais tarde, reintroduza-o com esse consumidor e com um payload mais claro do que "something changed."

## Verificação

`llm/adapter-change` e suas emissões não existem mais e o catálogo cordis regenerado está atualizado; a segurança sob HMR se mantém (o dispose de um fiber contribuinte remove o adaptador); `tools/change` e `system-prompt/change` continuam documentados e testados; e os snapshots do ACP (Agent Client Protocol) mais o teste de fumaça sem chave do Headless Loader fixam os caminhos de produção inalterados.

## Consequências

- **Remover um evento de emissão documentado é uma mudança de superfície pública.** Ele está na tabela de taxonomia, então é lido como API deliberada. Mas "declarado e emitido" não é "consumido": a mesma distinção que justificou remover o resumo mutável. A tabela de taxonomia é atualizada na mesma mudança, então a documentação não diverge.
- **A convenção de mudança de registry fica desigual.** Isso é aceitável porque o registro de adaptadores de LLM não é o mesmo conceito voltado ao usuário que ferramentas ou seções de prompt. Desigual, mas honesta, é melhor do que uniforme, mas morta.

Este é um corte pequeno, mas ele aposenta uma invariante permanente de correção que protege um consumidor que não existe.
