# Agent Note: Índice de grafos da documentação para mantenedores e usuários do SDK

Status: implemented
Archived: 2026-07-26

[English](2026-07-03-documentation-graph-atlas.md) | Português

## Problema

O repositório já tinha várias superfícies de documentação de alta confiança, cada uma em um eixo diferente: [module-graph.md](../../../../docs/module-graph.md) é gerado a partir das `peerDependencies` dos pacotes, os catálogos gerados de [eventos do Cordis](../../../../docs/cordis-catalog/events.md) e de [serviços](../../../../docs/cordis-catalog/services.md) são gerados a partir das declarações `Events` e `Context` do Cordis, [tool-catalog.md](../../../../docs/tool-catalog.md) é gerado ao inicializar os plugins de ferramenta entregues, e [core-data-structures/](../../../../docs/core-data-structures/core.md) usa blocos `ts type-equiv` para manter as definições de tipo coladas sincronizadas com o código-fonte.

Essas referências são precisas, mas são, em sua maioria, catálogos. Um mantenedor ainda precisa sintetizar as relações: quais pacotes formam um seam de capacidade, qual app empacota uma espinha dorsal concreta, qual evento é durável e qual é ao vivo, onde um hook ou um plugin de política pode interceptar o trabalho e qual ferramenta voltada ao modelo depende de qual serviço. Um usuário do SDK tem o mesmo problema por outro ângulo: "Qual pacote eu instalo ou carrego para o comportamento que quero, e qual evento/serviço/ferramenta eu estendo?"

O subsistema de hooks torna muito mais importantes a topologia de produtores/consumidores de eventos e os pontos de interceptação, e o seam de sistema de arquivos torna muito mais importantes os seams de capacidade, os vetos de política, a apresentação de ferramentas e os caminhos de montagem do SDK. Grafos de relações restritos a uma pequena superfície de bash/todo/subagent teriam ficado desatualizados imediatamente.

## Decisão

Adicionar documentos gerados de grafos de relações, indexados em [docs/graph-atlas.md](../../../../docs/graph-atlas.md), produzidos por geradores focados e verificados por `pnpm run verify-doc-graphs` / pelas verificações de atualidade de catálogo existentes, como parte do `doc-sync` (gate de sincronização da documentação).

O índice é uma camada de relações acima dos catálogos existentes. Ele não substitui as referências exatas; em vez disso, aponta para elas e explica como as peças se encaixam.

### Modos de manutenção

Toda página de grafo declara um modo de manutenção:

- **Gerado**: todos os nós e arestas são descobertos a partir do código-fonte; `--check` falha se o artefato commitado estiver desatualizado.
- **Híbrido gerado**: o código-fonte descobre o inventário, um pequeno manifest (lista de metadados) classifica a política irredutível, e uma guarda de completude falha se houver itens descobertos sem classificação.
- **Curado**: o diagrama explica a intenção de design, a ordem temporal ou a propriedade; ele é emitido pelo gerador para que os documentos de grafos continuem sendo uma unidade regenerada, mas o conteúdo é deliberadamente autoral.

### Primeiro índice entregue

O índice aponta para dez superfícies de relações. A topologia de pacotes e as possibilidades de cada pacote de ferramenta ficam nos catálogos gerados existentes, que já são donos desses fatos; os demais diagramas focados são gerados por `scripts/gen-doc-graphs.ts`.

| Grafo | Modo de manutenção | Fonte da verdade |
|---|---|---|
| [grafo de dependências de módulos](../../../../docs/module-graph.md) | gerado | peer dependencies de `packages/*/*/package.json` mais os caminhos dos grupos de pacotes |
| [catálogo de schemas de ferramenta e mapa de pacotes](../../../../docs/tool-catalog.md) | gerado | schemas de ferramenta coletados na inicialização mais os metadados de serviço/efeito dos pacotes de ferramenta |
| [seams de capacidade e serviços do core](../../../../docs/capability-seams.md) | híbrido gerado | declarações de serviço do Cordis mais um manifest de papéis em `gen-doc-graphs.ts` |
| [composição do app tui-agent](../../../../examples/tui-agent/composition.md) | híbrido gerado | lista de plugins de `examples/tui-agent/cordis.yml` mais a expansão curada de app/bundle |
| [composição do app headless-agent](../../../../examples/headless-agent/composition.md) | híbrido gerado | lista de plugins de `examples/headless-agent/cordis.yml` mais a expansão curada de app/bundle |
| [composição do app cordis-agent](../../../../examples/cordis-agent/composition.md) | híbrido gerado | lista de plugins de `examples/cordis-agent/cordis.yml` mais a expansão curada de app/bundle |
| [composição do app acp-agent](../../../../examples/acp-agent/composition.md) | híbrido gerado | lista de plugins de `examples/acp-agent/cordis.yml` mais a expansão curada de app/bundle |
| [matriz de produtores/consumidores de eventos](../../../../docs/event-producer-consumer.md) | híbrido gerado | declarações de evento do Cordis, pontos `ctx.on/emit/parallel/serial/waterfall` varridos por AST e sobreposições explícitas de dispatch dinâmico |
| [ciclo de vida de turno e etapa do agent](../../../../docs/agent-lifecycle.md) | curado | ciclo de vida do loop em architecture.md, links do catálogo do Cordis e semântica dos eventos de sessão |
| [pipeline de execução de ferramentas](../../../../docs/tool-execution-pipeline.md) | curado | semântica do pipeline de ferramentas e o waterfall `tools/execute` |

### Por que os geradores são donos dos documentos

A topologia de pacotes continua em `gen-module-graph.ts`, e as possibilidades de cada pacote de ferramenta continuam em `gen-tool-catalog.ts`, porque esses geradores já são donos dos fatos canônicos e das gates de atualidade. `gen-doc-graphs.ts` é dono das demais páginas de relações e do índice. A contrapartida é que os diagramas curados são editados em blocos de string do TypeScript, e não diretamente em Markdown. Isso é aceitável nesta primeira versão porque o artefato voltado ao usuário continua sendo Markdown/Mermaid simples, e uma mudança futura pode separar as páginas curadas se a ergonomia de autoria importar mais do que a regeneração.

### Guardas de completude

As páginas híbridas precisam falhar de forma ruidosa quando seus manifests estiverem desatualizados:

- O grafo de módulos lê as `peerDependencies` de todo pacote e agrupa cada pacote pelo caminho `packages/<group>/<pkg>`.
- O catálogo de ferramentas coleta na inicialização as ferramentas entregues e renderiza o mapa de pacote/serviço/efeito a partir do mesmo manifest que a guarda de completude dele já verifica.
- O grafo de seams de capacidade importa o coletor de serviços do Cordis e garante que todo `ctx.<key>` do harness descoberto esteja classificado em `SERVICE_ROLES` e que toda chave classificada ainda exista.
- A matriz de produtores/consumidores de eventos se rotula como híbrida porque os eventos de ciclo de vida de subagent usam deliberadamente `ctx.events.dispatch` para a contenção por listener; essas arestas dinâmicas são sobreposições explícitas, e não omissões invisíveis.
- `verify-mermaid` analisa toda cerca ` ```mermaid ` escrita no repositório com o parser do próprio Mermaid, então erros de sintaxe fazem o `doc-sync` falhar localmente e na CI, em vez de aparecerem como diagramas quebrados na renderização do GitHub.

## Alternativas consideradas

Os diagramas commitados usam Mermaid porque o GitHub o renderiza em Markdown e ele não adiciona nenhuma dependência nova ao build da documentação; dados densos de muitos para muitos, como as relações de produtores/consumidores de eventos, usam tabelas Markdown. **PlantUML, serviços hospedados de diagramas e SVGs gerados** foram considerados e deliberadamente não adotados até que o Mermaid se torne o fator limitante.

## Consequências

- Os mantenedores ganham pontos de entrada visuais para topologia, seams, fluxo de eventos, ciclo de vida e composição de apps.
- Os usuários do SDK ganham um caminho do caso de uso até a composição de pacotes, em vez de apenas referências de pacote de baixo para cima.
- O `doc-sync` agora inclui `verify-doc-graphs` e `verify-mermaid`, então a divergência dos grafos e os erros de sintaxe do Mermaid são detectados junto com as demais gates de atualidade da documentação.
- O trabalho futuro em fs e em hooks tem um lugar concreto para acomodar a nova complexidade: fs deve ampliar os documentos de capacidade e o catálogo de ferramentas, enquanto hooks deve ampliar a matriz de eventos e o pipeline de execução de ferramentas.
