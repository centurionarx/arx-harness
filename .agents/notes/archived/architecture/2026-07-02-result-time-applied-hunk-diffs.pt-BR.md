# Agent Note: Diffs de hunk aplicado no momento do resultado para mutações de arquivo

Status: implemented
Archived: 2026-07-27

[English](2026-07-02-result-time-applied-hunk-diffs.md) | Português

## Problema

A [união etiquetada de intenção de renderização](2026-07-02-tool-render-intent-union.md) dá a write/edit de `dsh-tool-fs` um `card:'diff'` no momento da chamada, derivado puramente dos argumentos da ferramenta: write ⇒ `{oldText:null, newText:content}` (o arquivo novo inteiro), edit ⇒ `{oldText:old_string, newText:new_string}` (o trecho substituído, sem mais nada). Uma UI consegue renderizar isso como um diff inline, mas é um diff **sem contexto**: o `old_string`→`new_string` puro, sem linhas ao redor, e um `replace_all` que tocou cinco pontos espalhados ainda é renderizado como um único par de trechos.

Conduzir a ponte ACP (Agent Client Protocol) do próprio `claude-agent-acp` mostra como é um diff completo de editor: depois que a mutação é aplicada, ela emite um SEGUNDO `tool_call_update` cujo diff é o **hunk aplicado com ±3 linhas de contexto** (e um hunk por ponto alterado no caso de `replace_all`), reconstruído a partir do `structuredPatch` da ferramenta. Esse hunk do momento do resultado é o que faz o Zed mostrar a mudança *no lugar*, dentro do arquivo, e não como um trecho solto. Nossas ferramentas paravam no trecho do momento da chamada; o resultado concluído carregava apenas o texto simples "updated successfully", sem diff.

O obstáculo é uma fronteira de seam: `presentResult(args, result)` é uma **função pura de `args` + o `result` voltado ao modelo (`{content, isError}`)**. Ela roda no streaming ao vivo E no replay do log da sessão, então precisa ser determinística no replay e não pode fazer I/O. Ela nunca vê o conteúdo do arquivo antes e depois, e `FsEditOutcome`/`FsWriteOutcome` carregavam apenas uma contagem de substituições + versão, não o texto. Portanto não havia como calcular, nem mesmo carregar, um hunk aplicado até o presenter.

## Decisão

Adicionar um **canal de apresentação persistido e privado da ferramenta**, para que o `execute` de uma ferramenta possa anexar um payload de renderização do momento do resultado que sobrevive ao replay, e usá-lo para carregar o diff de hunk aplicado.

### 1. Uma projeção de apresentação reproduzível por replay sobre a saída canônica da ferramenta (core)

A implementação original deixava `execute` retornar `{ content, meta }`. O [contrato de saída canônica de ferramenta](2026-07-20-canonical-tool-output-contract.md) substitui esse formato de autoria: toda ferramenta agora retorna um único valor JSON declarado por schema, `output.render(args, value)` deriva os blocos voltados ao modelo e o `output.presentationMeta(args, value)` opcional deriva dados de UI reproduzíveis por replay.

`presentationMeta` é um `JsonValue` de propriedade da ferramenta, que o core persiste sem interpretar seus campos. `Session.append` o valida junto com o restante do evento, e o replay devolve o payload armazenado a `presentResult`; as apresentações, portanto, se reproduzem sem I/O nem recálculo. O valor canônico em si continua local à execução e não é adicionado ao formato de sessão.

Isso continua sendo o formato geral ("uma ferramenta projeta uma apresentação durável do resultado"), não um formato específico de fs: qualquer ferramenta pode usá-lo.

### 2. A ferramenta calcula o hunk; o backend retorna o antes e o depois (fs)

Conforme a [divisão do seam de capacidade](2026-06-13-capability-seams.md), o backend de armazenamento retorna apenas **fatos de armazenamento**, e a ferramenta voltada ao modelo é dona da **apresentação**:

- `dsh-fs` amplia `FsEditOutcome` com `{ before: string; after: string }` e `FsWriteOutcome` com `{ before: string | null; after: string }` (`before: null` ⇒ uma criação, ou um arquivo binário/não UTF-8 existente, mas impossível de comparar). O backend local já tem os dois textos em mãos no momento da escrita; ele os retorna como texto bruto normalizado para LF, **sem que nenhum conceito de diff/UI** entre no seam.
- `dsh-tool-fs` retorna os fatos canônicos de antes e depois da mutação e projeta hunks contextuais como `meta: { diffs: FileDiff[] }`. Mutações bem-sucedidas são concluídas com uma visualização de diff: criações ou sobrescritas sem alteração recorrem a um diff de arquivo inteiro derivado dos argumentos, enquanto edições usam hunks aplicados. Mutações que falham não carregam metadados de diff e renderizam o erro normalmente.

### 3. Os transportes de UI renderizam uma visualização de resultado `diff`

`ToolResultView` inclui `DiffResultView { card:'diff'; title?; diffs: FileDiff[] }`. Os consumidores de TUI e de JSON-RPC/Web fazem switch sobre a mesma visualização etiquetada e substituem o trecho sem contexto da chamada pendente pelo hunk aplicado do resultado. A [ponte ACP exclusiva para automação](../simplification/2026-07-23-acp-automation-only-protocol.md) não carrega apresentação de ferramenta.

## Alternativas consideradas

**Escrever à mão ou vendorizar o algoritmo de diff.** Hunks contextuais têm casos de borda bem conhecidos, então `dsh-tool-fs` usa o pacote tipado [`diff`](https://www.npmjs.com/package/diff) e normaliza a saída de `structuredPatch` em um único módulo. A política de vendoring do repositório se aplica ao código-fonte do framework dele, não a todo utilitário folha.

## Consequências

Os eventos `tool/result` carregam um payload `meta` privado da ferramenta, parte do vocabulário em disco e restrito a JSON em tempo de execução por `Session.append`, e qualquer ferramenta pode projetar uma apresentação durável do resultado sem outra mudança no core. O cartão de diff se reproduz de graça ao recarregar a sessão e no replay de snapshot: ele é lido de volta do log, nunca recalculado. Os custos: uma sobrescrita mantém em memória tanto o texto anterior quanto o novo para calcular um hunk usado só pela UI (`TODO(overwrite-diff-bound)`), e `dsh-tool-fs` carrega uma dependência de runtime pequena e bem conhecida.

## Fora do escopo

- **Streaming incremental de diff ao vivo.** O hunk é calculado uma vez, depois que a mutação termina; não há diff por tecla digitada.
- **Diff de uma sobrescrita de arquivo binário/não UTF-8.** `before` é `null` para um arquivo assim (ele não tem base textual para diff); a escrita ainda é bem-sucedida e o resultado renderiza um diff de arquivo inteiro (`oldText: null`), e não um hunk contextual.
- **Diffs de renomeação/movimentação.** Apenas diffs de conteúdo de um único caminho resolvido.
- **Limitar a base do diff de sobrescrita.** Uma sobrescrita lê o arquivo anterior inteiro para a memória a fim de calcular o hunk contextual (além do conteúdo novo, que já está em memória), então a sobrescrita de um texto muito grande aloca os dois textos para um diff usado só pela UI. Um refinamento futuro pode limitar a leitura prévia e recorrer a um diff de arquivo inteiro, ou a nenhum diff contextual, acima de um limite de tamanho; isso é acompanhado como `TODO(overwrite-diff-bound)` no ponto da leitura.

## Relacionados

- Conclui a única diferença de representação restante, apontada como fora do escopo em [União etiquetada de intenção de renderização](2026-07-02-tool-render-intent-union.md): a seção de itens fora do escopo daquela Agent Note foi atualizada para registrar que os diffs de hunk aplicado foram entregues aqui.
- Apoia-se no [seam de capacidade de sistema de arquivos](2026-06-17-filesystem-capability-seam.md) (o antes e o depois são fatos de armazenamento que o backend retorna) e nas [sessões baseadas em event sourcing](2026-06-11-event-sourced-sessions.md) (o payload `meta` persiste no evento `tool/result`, então o replay reproduz o cartão).
- O canal `meta` é deliberadamente genérico: uma ferramenta futura (uma busca estruturada, um resultado em tabela de dados) pode anexar a própria apresentação durável do resultado sem outra mudança no core.
