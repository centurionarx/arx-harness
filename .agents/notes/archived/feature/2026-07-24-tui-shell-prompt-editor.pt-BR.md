# Agent Note: Editor da TUI com prompt de shell

Status: implemented
Archived: 2026-08-04

[English](2026-07-24-tui-shell-prompt-editor.md) | Português

## Problema

O editor do pi-tui upstream sempre renderiza linhas horizontais de moldura. Essa apresentação separa a entrada do transcript (registro textual da sessão), mas ocupa duas linhas do terminal e não se parece com a entrada orientada a comandos usada pelos shells.

## Decisão

A TUI apresenta um prompt de duas linhas. Uma linha de contexto, de propriedade do DSH, mostra o diretório de trabalho, o tempo do turno em execução, o branch do Git (opcional), o modelo atual, os totais de tokens, a taxa de acerto de cache e a pressão de contexto como segmentos com prioridades independentes. Terminais estreitos omitem os segmentos de menor prioridade e mantêm o diretório, seguido do tempo de execução quando ele está presente. A segunda linha usa um prefixo `dsh> ` de largura fixa e um recuo de continuação de mesma largura; a orientação de steering (direcionamento no meio da execução) e cancelamento exibida durante a execução é um texto de placeholder que desaparece quando a digitação começa.

O pacote `@earendil-works/pi-tui` fixado carrega um patch do pnpm que acrescenta `frame: "none"` e prefixos de prompt de largura fixa a `EditorOptions`. O padrão continua sendo a moldura horizontal do upstream, então só o editor do DSH adota o comportamento. Os prefixos precisam ter larguras visíveis iguais; a construção falha quando elas diferem. Entrada, quebras de linha explícitas, autocompletar, posicionamento do cursor e indicadores de rolagem compartilham a largura reduzida da primeira linha; linhas quebradas automaticamente não renderizam prefixo, então o texto delas começa no padding esquerdo do editor, ocupa as colunas do prefixo e quebra na largura total do conteúdo.

O patch fica limitado ao JavaScript e às declarações publicados do editor. Manter a dependência fixada na versão exata faz a instalação aplicar o patch conhecido ou falhar, em vez de descartar a apresentação em silêncio.

## Alternativas consideradas

**Filtrar a saída renderizada do editor em um wrapper.** Isso dependeria de reconhecer linhas de borda e de indicador de rolagem estilizadas com ANSI e de distinguir a saída do autocompletar da saída da entrada, e tudo isso são detalhes de renderização não documentados.

**Vendorizar o pacote pi-tui completo.** O projeto recebe atualizações frequentes, enquanto esta mudança precisa apenas de uma opção localizada de renderização do editor. Assumir o código-fonte completo e o processo de sincronização acrescentaria uma manutenção desproporcional.

**Manter a moldura horizontal.** Isso evita customizar a dependência, mas mantém a apresentação que a mudança pretende substituir.

## Consequências

O editor e o contexto usam duas linhas em vez do editor com moldura mais o rodapé, com uma linha em branco separando a área do prompt dos cartões de conversa. A apresentação persistente omite a identidade da sessão e o modo dos cartões de ferramenta; `/status` e os comandos mantêm esses detalhes. O layout da entrada e o autocompletar perdem seis colunas para o prefixo do prompt, mas o texto quebrado usa as colunas do prefixo que de outro modo ficariam em branco. A rolagem sem borda usa linhas avulsas `↑ N more` e `↓ N more`.

A representação interna dos segmentos estabelece prioridades de largura sem expor uma linguagem pública de customização. Uma futura configuração no estilo do Starship pode se apoiar nela depois que os módulos padrão e o comportamento de overflow tiverem evidência de produção.

Uma atualização do pi-tui exige revisar o patch e reaplicá-lo ou aposentá-lo. Os snapshots de terminal da TUI fixam a apresentação montada, incluindo os módulos de contexto, a cor do prompt, o alinhamento, o posicionamento do cursor e a largura do autocompletar.
