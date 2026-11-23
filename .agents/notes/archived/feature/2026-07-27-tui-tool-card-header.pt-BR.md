# Agent Note: Cabeçalho fixo `Tool / <name>` para os cartões de chamada de ferramenta

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-tui-tool-card-header.md) | Português

## Problema

A TUI renderizava cada chamada de ferramenta como `{glyph} {title}`, em que `title` era a string do presenter que fundia verbo e detalhe (`Read src/index.ts (1200-1360)`, `Edit files` ou a descrição do modelo em um cartão bash), em negrito e sublinhada na cor de status. Um único slot plano carregava ao mesmo tempo a identidade da ferramenta, o alvo e o status, e a estilização misturava negrito, sublinhado e cor de forma inconsistente: o cabeçalho era lido como ruído, e qual ferramenta rodou não se separava visualmente daquilo sobre o que ela operava.

## Decisão

O cabeçalho é uma moldura fixa `{ring} Tool / <name>` em uma única cor de status plana, sem negrito, sem sublinhado e sem esmaecimento, de modo que uma só cor é lida de forma consistente na linha inteira. `Tool` é uma constante literal; `<name>` é o nome bruto da ferramenta. O separador é o `/` ASCII. O marcador de anel é `○` enquanto a chamada está pendente e `●` depois que ela se resolve; a cor do cabeçalho (aviso para pendente / sucesso para ok / erro) distingue pendente de ok e de erro, então o mesmo anel preenchido serve aos dois estados resolvidos.

O cabeçalho carrega exatamente um extra opcional: a descrição escrita pelo modelo em um cartão bash (terminal), anexada como um segmento ` / <desc>` (`● Tool / bash / Run the coverage gate`). Nenhuma outra ferramenta contribui com um detalhe de cabeçalho.

Todo detalhe específico de ferramenta passa para o bloco de corpo abaixo do cabeçalho. O título do presenter de um cartão que não é de terminal (`Read src/index.ts`, `Grep pattern`) vira a primeira linha do corpo, a menos que apenas repita o nome da ferramenta (o presenter de fallback de uma ferramenta sem `presentCall`, ou uma ferramenta desconhecida), que o cabeçalho já mostra. Um cartão de terminal mantém o comando como a linha `$`. Um cartão de diff descarta o título por completo, porque os cabeçalhos de caminho por arquivo e um rodapé de alterações carregam o significado, e anexa um rodapé esmaecido `└ +A -R · N file(s)` que resume as contagens de linhas adicionadas/removidas em todos os arquivos.

O redesenho vale apenas para a TUI. Ele toca `ToolCardComponent` em `packages/ui/tui/src/components/transcript.ts` e nenhum presenter: a moldura `Tool / <name>` deriva o nome no lado da TUI a partir do nome da ferramenta da chamada, e a realocação do título para o corpo reutiliza o título do presenter que já é retornado. `presentation.ts` e todos os `presentCall`/`presentResult` ficam inalterados.

## Alternativas consideradas

**Deixar o nome em negrito para destacá-lo.** Rejeitado: em terminais que renderizam SGR-1 como a variante clara da cor, um nome verde em negrito é lido como uma cor diferente do restante do cabeçalho verde, o que reintroduz a inconsistência que o redesenho elimina. O nome se destaca pela posição na moldura fixa, não pelo peso.

**Manter o título do presenter no cabeçalho** (por exemplo, `Tool / read / Read src/index.ts`). Rejeitado: o verbo duplica o nome da ferramenta, e as ferramentas que não são bash não têm uma descrição de uma linha genuinamente distinta; o alvo pertence ao corpo, então só o bash contribui com uma descrição de cabeçalho.

**Um rodapé de resumo para todo tipo de cartão** (contagens de linhas, pílulas de exit, contagens de diff como uma linha `└ …` uniforme). Adiado: só o rodapé de diff foi entregue. O exit de terminal mantém a linha esmaecida `[exit N]` que já existia, a saída longa mantém a elisão do meio com início e fim que já existia, um resultado vazio fica só com o cabeçalho e um corpo de erro fica sem estilo (só a cor do cabeçalho carrega o erro): os tratamentos atuais foram mantidos de propósito, não por omissão. A estilização plana do corpo, na cor de primeiro plano padrão, foi revista depois: a [apresentação consolidada da TUI](../architecture/2026-07-28-consolidated-tui-presentation.md) recua o corpo inteiro para um único tom esmaecido sob o cabeçalho de status colorido desta nota.

## Consequências

Uma chamada de ferramenta agora mostra sua identidade em um único lugar estável, e o status é lido como uma cor plana por linha, de modo que um transcript (registro textual da sessão) com muitas chamadas é percorrido como uma coluna de `Tool / <name>`, e não como uma parede de strings de verbo com estilos misturados. O custo é uma linha extra de corpo para as ferramentas que não são de terminal (o título realocado) e a perda da supressão de redundância anterior, que omitia o caminho por arquivo de um diff quando o cabeçalho já o nomeava: o cabeçalho não nomeia mais nenhum caminho, então todo diff imprime seu caminho uma vez. Como a mudança fica restrita a `ToolCardComponent`, as outras pontes de UI (ACP, JSON-RPC) mantêm a própria apresentação de chamadas de ferramenta; a forma `Tool / <name>` é local à TUI e não faz parte de nenhum contrato entre pacotes.

## Testes

`packages/ui/tui/tests/tui.spec.ts` fixa o novo cabeçalho (`Tool / <name>`), o título de diff descartado, o título genérico realocado e o rodapé `· N file(s)`. Os snapshots semânticos do pacote cobrem as famílias de cartões em um terminal headless. As jornadas de aplicação excluídas forneciam antes as execuções de ferramenta montadas; um futuro deploy de terminal é dono da cobertura de transcript equivalente.
