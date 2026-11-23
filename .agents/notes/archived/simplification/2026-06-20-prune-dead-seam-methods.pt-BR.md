# Agent Note: podar métodos mortos do seam de persistência

Status: implemented
Archived: 2026-07-26

[English](2026-06-20-prune-dead-seam-methods.md) | Português

> **Nota de implementação:** Apenas `SessionPersistence.has()` e `.delete()` foram removidos. `BashExecutor.get()` e `.list()` permanecem porque remover a superfície de consulta de uma linha deles exigia bem mais maquinário de acompanhamento de conclusão nos consumidores. A marcação (branding) dos ids deles é coberta pela [Agent Note de branded-ids](../architecture/2026-06-20-branded-ids.md).

## Problema

Um seam de capacidade ([interface / implementação / consumidor](../architecture/2026-06-13-capability-seams.md)) carrega métodos abstratos que nenhum consumidor chama. O seam existe para deixar implementações e consumidores evoluírem de forma independente, mas um método contra o qual nenhum consumidor programa não é um seam: é superfície especulativa que toda implementação ainda precisa implementar e testar.

### `SessionPersistence.has()` e `.delete()`

O serviço abstrato declarava suas operações além de create/append: `load`, `list`, `has`, `delete`. Os consumidores de produção usam `load()` e `list()` para a retomada e para a descoberta de sessões, enquanto nenhum chamador de produção usa o `has()` ou o `delete()` da persistência. As chamadas de nome parecido a coleções em memória, no código de protocolo e de UI, não têm relação. Os únicos chamadores do `has`/`delete` da persistência eram as suítes de contrato e as specs de cada backend.

`has()` não estava apenas sem uso: ele acrescentava uma sondagem do coordenador entre rastreado e não rastreado e um ramo de contrato, embora `loadStored(id)` já seja dono das verificações de existência durável. `delete()` arrastava o hook de backend `deleteStored`, que todo backend tinha de implementar. Este é o padrão de [drop-mutable-session-summary](2026-06-19-drop-mutable-session-summary.md): um teste de contrato exercitava os dois, mas nenhum código distribuído pergunta "esta sessão está persistida?" nem remove uma.

## Decisão

Os métodos que nada consome são removidos do seam abstrato, da implementação e das suítes de contrato/spec que existiam só para exercitá-los:

- `SessionPersistence.has()` / `.delete()` se foram: as declarações abstratas, o `has`/`delete`/`deleteCore` do coordenador e o hook `PersistenceBackend.deleteStored` (jsonl + sqlite implementavam `deleteStored` cada um só para satisfazer o hook; essas implementações também se foram). Os backends são o design de [dual-backend](../architecture/2026-06-14-session-persistence.md) e, de resto, estão fora do escopo; remover um hook que eles implementavam para nenhum consumidor faz parte de remover o hook, não é um redesenho de backend.
- Toda referência em documentação e em comentário de código-fonte é atualizada para o contrato sobrevivente de quatro métodos, só com `list()`: não apenas as grafias literais `has(`/`delete(`/`deleteStored`, mas também os links de JSDoc `{@link has}`/`{@link delete}` e as contagens de "six public methods", nos READMEs do seam e dos backends, em [docs/architecture.md](../../../../docs/architecture.md), nas Agent Notes de [session-persistence](../architecture/2026-06-14-session-persistence.md) e de [write-coordinator](../architecture/2026-06-18-shared-persistence-write-coordinator.md), e no JSDoc do coordenador e dos backends.

## Alternativas consideradas

### Por que não mantê-los porque "o seam deveria ser completo"?

O instinto de que um seam de persistência "deveria" oferecer delete é real, e é exatamente a completude especulativa contra a qual a postura de pré-lançamento alerta ([AGENTS.md](../../../../AGENTS.md): otimize para a fundação correta, não para chamadores hipotéticos que você não tem). `delete()` é um único método a readicionar no dia em que um consumidor precisar dele: uma UI de gerenciamento de sessões que exclui sessões antigas vai querê-lo; adicione-o então, projetado contra as necessidades reais dessa UI (soft-delete? cascata? confirmação?), e não adivinhado agora.

Readicionar um método de seam com um consumidor vivo é barato e resulta em um design melhor do que a versão especulativa, porque o consumidor fixa o contrato. Carregá-lo sem uso significa que toda implementação (e todo backend futuro) precisa implementar e testar um método que não faz nada.

## Verificação

`has`/`delete`/`deleteStored` se foram do seam de persistência, da implementação e das suítes de contrato, sem novas exportações mortas; as operações restantes (`create`/`append`/`load`/`list`) ficam intocadas, com as consultas de sessão apoiadas em persistência e a recuperação após falha se comportando de forma idêntica; e o README do seam e `docs/architecture.md` listam apenas os métodos sobreviventes.

## Consequências

- **`delete()` é o tipo de operação que um produto acaba querendo.** Verdade, mas o "acaba" é justamente o ponto. Excluí-lo agora e readicioná-lo contra um consumidor real é estritamente melhor do que distribuir um contrato adivinhado. Cada um dos dois backends se livra de uma implementação de `deleteStored`, o que é uma edição limitada em pacotes que, de resto, estão fora do escopo.
- **Baixo acoplamento.** A remoção fica confinada ao seam de persistência + implementação + testes; nenhum consumidor de outro pacote referencia os métodos removidos, então não há propagação além da documentação.

O tamanho é modesto, mas ela converte o seam de "o que uma implementação precisa fornecer para ninguém" de volta para "exatamente o que um consumidor usa".
