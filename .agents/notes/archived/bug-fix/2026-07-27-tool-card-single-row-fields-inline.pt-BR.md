# Agent Note: Campos de linha única do cartão de ferramenta são renderizados inline

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-tool-card-single-row-fields-inline.md) | Português

## Problema

O título, a descrição, o cwd e o eco pendente `$ <command>` de um cartão de ferramenta ocupam, cada um, uma linha lógica. A ferramenta bash define o título do cartão (e a descrição) diretamente a partir do comando e da descrição do modelo, que, em um script bash de várias linhas, contêm quebras de linha reais. Esses campos eram escapados com `displayText`, que preserva `\n` deliberadamente como layout estrutural. Um título de várias linhas, portanto, quebrava em linhas extras do terminal que a contagem de linhas do cartão não reservava, de modo que as linhas seguintes do título sobrescreviam a descrição, a saída ou a dica de steering (direcionamento no meio da execução) do editor: o cartão era renderizado como texto embaralhado e sobreposto. A remoção da barra da margem (veja a [nota do transcript copiável](../simplification/2026-07-27-copyable-transcript-no-gutter-bar.md)) tornou a colisão visível porque essas linhas deixaram de ficar atrás de um prefixo por linha.

## Decisão

Os campos de linha única do cartão usam `displayInlineText` (que escapa `\n` para o literal `\x0a`) em vez de `displayText`: o título do cartão, as linhas de metadados `description` e `cwd` do cartão de terminal e o eco pendente `$ <command>`. Cada um permanece em exatamente uma linha, então um comando de várias linhas não consegue mais quebrar linhas e colidir com as linhas adjacentes. Os campos genuinamente de várias linhas, a saída capturada do comando e o corpo de resultado `contentText`, mantêm `displayText` mais `split('\n')`, porque ocupam várias linhas de forma legítima.

## Alternativas consideradas

- **Remover as quebras de linha da saída do presenter** (na ferramenta bash): esconde o formato real do comando do modelo de qualquer consumidor da view e empurra uma preocupação de UI para dentro da ferramenta. O escape pertence ao ponto de renderização de linha única.
- **Deixar o título quebrar em várias linhas de propósito**: o título de um cartão é uma identidade de uma linha; um título quebrado em várias linhas ainda colide com as linhas de metadados seguintes, a menos que o layout do cartão inteiro seja refeito, e incha o transcript (registro textual da sessão).

## Consequências

- Comandos bash de várias linhas são renderizados como um único título inline (`S=/tmp\x0aecho …`); as linhas de descrição, de saída e de exit abaixo permanecem intactas. Verificado ao vivo no tmux nos estados pendente (`◌`) e concluído (`✓`).
- Um caso de cartão de ferramenta `multilineTerminal` em `tui.spec.ts` verifica que a forma escapada inline aparece para um título e uma descrição que contêm quebras de linha.
