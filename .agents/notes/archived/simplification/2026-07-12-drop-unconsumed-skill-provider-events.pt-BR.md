# Agent Note: Remover os eventos de provedor de skill sem consumidor

Status: implemented
Archived: 2026-07-26

[English](2026-07-12-drop-unconsumed-skill-provider-events.md) | Português

## Problema

Duas notificações do registry de skill (habilidade) são produzidas, mas não têm nenhum listener de produção. A matriz gerada de produtores e consumidores e as buscas exatas por nome de evento encontram apenas declarações, pontos de emissão, testes, catálogos gerados e prosa para `skill/provider-added` e `skill/provider-removed`.

A descoberta de skills lê o mapa atual de provedores sob demanda, o registro de provedores limpa de forma síncrona os catálogos concluídos e a verificação de revisão posterior ao await impede que uma descoberta desatualizada entre no cache. Nenhum plugin irmão espera por um provedor de skill por meio desses eventos, ao contrário do consumidor ativo de `subagent/provider-added`, que tolera o carregamento concorrente de irmãos.

`tools/change` e `system-prompt/change` estão explicitamente fora desta proposta. Decisões de simplificação existentes os mantêm como pontos de observação intencionais para UIs ao vivo de ferramentas e de prompt, e plugins montados autorreferenciais já usam `tools/change`. Esta proposta também deixa `subagent/provider-added`/`removed` inalterados porque `tool-subagent` tem um consumidor de ciclo de vida em produção.

## Decisão

O registry de skills não declara nem emite eventos de pertencimento de provedores. O registro e o dispose (liberação de recursos) de provedores continuam sendo mudanças de estado diretas, pertencentes a efeitos, que invalidam de forma síncrona os catálogos concluídos; a consulta e a descoberta leem o mapa atual de provedores sob demanda. Os testes observam a limpeza pela consulta de provedores e pela saída coletada, e não por notificações de ciclo de vida.

O catálogo de eventos gerado, o catálogo de API e a matriz de produtores e consumidores omitem as notificações removidas. A Agent Note do sistema de skills e a documentação do pacote descrevem o registro por meio de seu estado direto pertencente a efeitos e de seu contrato de invalidação de cache.

## Alternativas consideradas

**Manter as notificações de provedor de skill para plugins futuros.** Um plugin de terceiros poderia observar a disponibilidade de provedores, mas o registro direto de provedores e a consulta sob demanda são o contrato de extensão; nenhum consumidor atual precisa de um sinal de push. Se uma corrida de carregamento entre irmãos surgir no futuro, ela pode introduzir uma notificação com a semântica de identidade e de prontidão que esse consumidor exigir, como fez o registry de subagents.

## Consequências

A matriz de eventos gerada não contém nenhuma linha para `skill/provider-added` nem para `skill/provider-removed`. A descoberta de skills, o registro direto em runtime, o rollback/dispose de efeitos de provedores, a invalidação de cache e a limpeza de consulta do registry permanecem; o rollback disparado por listener desaparece junto com os eventos. `tools/change`, `system-prompt/change` e os eventos consumidos de ciclo de vida de provedores de subagent ficam inalterados.

Os consumidores de pré-lançamento perdem os pontos de observação de provedores de skill, mas mantêm as duas formas de contribuir com skills: o registro direto em runtime e o registro de provedores. Um futuro consumidor que precise da disponibilidade de provedores ao vivo deve adicionar uma notificação feita sob medida, com a semântica de identidade e de prontidão de que ele de fato precisa.
