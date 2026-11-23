# Agent Note: O cartão de diff da TUI deixou de repetir o caminho do arquivo

Status: implemented
Archived: 2026-07-31

[English](2026-07-27-tui-diff-card-redundant-path-header.md) | Português

## Problema

Os cartões das ferramentas `edit` e `write` imprimiam o caminho de destino duas vezes. O `presentCall`/`presentResult` de cada ferramenta retorna um cartão de diff cujo título é `Edit <path>`/`Write <path>` e cujo único `FileDiff` carrega o mesmo `path`. O `diffLines` da TUI renderizava incondicionalmente `palette.bold(diff.path)` como cabeçalho por arquivo, então uma edição de um único arquivo era renderizada assim:

```
✓ Edit src/foo.ts
src/foo.ts
- old
+ new
```

A fixture (dados de teste pré-montados) de snapshot existente escondia o bug: ela dava ao cartão de edição o título `Edit renderer` (sem caminho) e dava dois diffs ao resultado, então o título nunca coincidia com o caminho de um diff e o cabeçalho nunca parecia redundante.

## Decisão

`diffLines` recebe uma flag `showPath`; `ToolCardComponent.renderBody` suprime o cabeçalho por arquivo de um cartão de diff quando há exatamente um diff e o título efetivo do cartão (`resultView?.title ?? callView.title`) já contém o caminho desse diff. Cartões de diff com vários arquivos mantêm todos os cabeçalhos por arquivo. Um caminho de diff vazio ou em branco é suprimido pela mesma verificação com `String.includes`, e essa é a remoção de ruído pretendida.

A supressão fica no renderizador da TUI, não no presenter de cada ferramenta, porque a redundância é uma questão de apresentação comum a todo cartão de diff de arquivo único, atual ou futuro; as ferramentas continuam emitindo o caminho tanto no título quanto no diff, para que os consumidores que não são a TUI ainda o recebam.

## Alternativas consideradas

- Remover o caminho dos títulos dos cartões `edit`/`write`. Rejeitada: o título é a linha de resumo que se lê de relance; remover o caminho a enfraquece, e a remoção teria de ser repetida em cada ferramenta.
- Sempre remover o cabeçalho por arquivo. Rejeitada: diffs de resultado com vários arquivos (e qualquer cartão de diff com vários arquivos que venha a existir) realmente precisam dos cabeçalhos por arquivo.

## Consequências

A heurística é uma comparação por substring, então um título que por acaso contenha o caminho de um único diff suprime o cabeçalho mesmo que a coincidência seja incidental; nos produtores reais o título é exatamente `Verb <path>`, então isso é correto na prática. A fixture `edit` do snapshot agora espelha a produção: um único diff cujo caminho o título nomeia, o que prova que o cabeçalho é removido, enquanto a manutenção dos cabeçalhos com vários arquivos é coberta pela fixture `edit` de `tui.spec.ts` (`a.txt`/`b.txt` sob um título `Edit files`).

## Testes

`tui.spec.ts` adiciona um caso focado que verifica que o caminho aparece exatamente uma vez em um cartão de diff único com o título `Edit src/only.ts`. Os snapshots `advanced-cards-*`, que rodam sem chave, foram regravados para mostrar a linha de título seguida imediatamente pelo corpo do diff, sem cabeçalho de caminho repetido.
