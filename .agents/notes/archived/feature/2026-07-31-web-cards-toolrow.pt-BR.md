# Agent Note: As linhas de ferramenta com cartão recolhem por um único ToolRow

Status: implemented
Archived: 2026-08-07

[English](2026-07-31-web-cards-toolrow.md) | Português

## Problema

O cliente Web acumulou cinco intenções de renderização de cartão ao longo de PRs sucessivos (terminal, diff, read, search, web), cada uma chegando como um registrante de toolview com chave em `packages/client/ui-conversation/src/client/toolviews/`. Elas divergiram de duas formas que cada PR anterior reconheceu, mas adiou:

- **Duplicação de chrome.** `read-row`, `search-row`, `web-row` e `file-mutation-row` desenhavam à mão, cada um, a linha de resumo (slot de estado inicial, status visualmente oculto, título, ponto separador, link de caminho/resumo) como o próprio `<div className={css.root}>` com um `.module.css` privado, em vez de compor o `ToolRow` compartilhado. `read-row` carregava um marcador `jscpd:ignore` que nomeava a duplicação e apontava para "a separate change tracked for all rows at once", que é esta mudança.
- **Residente vs. recolhido.** Essas quatro linhas mantinham o cartão delas (`ReadBlock`/`SearchBlock`/`WebBlock`/`DiffBlock`) residente abaixo do resumo, sempre expandido, enquanto o cartão de terminal (via `GenericToolCard`/`BashRow`) e toda linha de texto começavam recolhidos atrás da expansão de linha inteira do ToolRow. Uma conversa com várias chamadas de read/search/web/edit virava uma parede de cartões sempre abertos, o que anulava o propósito do fluxo de mensagens como superfície de resumo.

## Decisão

`ToolRow` é dono de todo tipo de cartão, e toda linha de cartão com chave o compõe. O ToolRow já recebia o material de cartão `terminal` e `diff`; agora ele também recebe `read`, `search` e `web`, e renderiza o que estiver presente no corpo expandido, recolhido por padrão, por meio da primitiva correspondente (limitada pelos limites `CHAT_*` do chat). Uma chamada carrega no máximo um tipo de cartão, então as props são mutuamente exclusivas e o corpo escolhe a primeira presente.

As quatro linhas com chave (`ReadRow`, `SearchRow`, `WebRow`, `FileMutationRow`) abandonam o chrome desenhado à mão e o CSS privado e se tornam composições finas de `ToolRow`, exatamente como `AskQuestionRow`: derivam o modelo do cartão, passam esse modelo como a prop correspondente do ToolRow e encaminham `filePath`/`onOpenFile` para as ferramentas de arquivo e `output`/`errorSummary` para os caminhos de falha sem cartão. Cada linha agora é `ToolRowProps & PropsLocale<'conversation'>` e se registra com `locale: NS`, porque o ToolRow precisa do `t` de conversation para o texto do corpo de terminal/código. `GenericToolCard` (o fallback no ponto de renderização) faz o mesmo para read/search/web, então uma ferramenta que declara cartão sem ter a própria linha com chave recolhe de forma idêntica.

A seção Output do `DetailsPanel` não muda: o painel é a superfície de leitura de uma única chamada, então ele renderiza cada cartão residente na altura total da primitiva, e uma busca limitada mantém ali o rodapé de recuperação.

## Consequências

- Uma única interação de expansão em todas as linhas de ferramenta: resumo recolhido de uma linha, e a linha inteira alterna o cartão. O cartão não está no DOM até ser expandido (`DisclosureRow` renderiza `children` apenas quando aberto), então os testes verificam ausente e depois presente em torno de um clique em `[data-expandable]`.
- Removidos: `read-row.module.css`, `search-row.module.css`, `web-row.module.css`, `file-mutation-row.module.css`, `GenericToolCard.module.css`. As linhas não carregam CSS próprio; o módulo do ToolRow é dono do chrome e do recuo do corpo do cartão.
- Os caminhos de falha sem cartão (uma mutação com erro, uma busca com erro/aninhada/legada) não desenham mais o próprio `.failure`/`<div>` de recuperação; eles usam o `output` (seção Output) e o `errorSummary` (primeira linha do resumo recolhido) do ToolRow, que já achatam o texto do resultado com o fallback `error.name: error.code`.
- `bash-sample` mantém deliberadamente o próprio chrome local de expansão (o exemplar da postura de terceiros, que nunca importa o domínio do chat); ele já era recolhido, então o comportamento dele não muda.

## Alternativas consideradas

- **Manter as linhas residentes e unificar só o chrome.** Rejeitada: o requisito do usuário é recolhido por padrão, e os cartões residentes são o que tornava o fluxo impossível de percorrer de relance.
- **Um wrapper `CardRow` compartilhado entre as linhas e o ToolRow.** Rejeitada: o ToolRow já é esse wrapper depois que recebe todo tipo de cartão; uma segunda camada seria a extração prematura contra a qual as regras do pacote alertam.
