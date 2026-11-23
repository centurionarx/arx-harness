# Agent Note: varredura de polimento da UI de conversa da Web

Status: implemented
Archived: 2026-08-07

[English](2026-07-28-web-conversation-polish-sweep.md) | Português

## Problema

Uma revisão de design das superfícies de conversa da GUI web encontrou um lote de defeitos de apresentação: os menus em portal eram pintados por um quadro na posição errada antes de se reposicionarem (salto visível na abertura), a coluna do chat dividia uma única sequência de ferramentas em vários grupos sempre que a mensagem de uma etapa trazia apenas cabeçalhos de chamada de ferramenta, os resumos das linhas de ferramenta imprimiam caminhos absolutos do workspace que consumiam a maior parte da linha, a varredura da linha em execução era implementada como uma máscara alfa que escurecia a linha inteira, o chip de workspace do hero ressuscitava o nome da pasta de um workspace excluído a partir do cwd da sessão, e o cabeçalho mostrava um contador de turnos que ninguém pediu ao lado de um título de 13px.

## Decisão

A varredura entra apenas como mudanças na camada de apresentação; nada entra no log de sessão.

- **Os menus em portal são pré-renderizados ocultos e medidos antes da pintura.** A lista do menu é montada com `visibility: hidden` em (0,0), é medida em `useLayoutEffect` e fica visível já na posição final. Os menus mantêm 12px de folga em relação à viewport, com rolagem interna; as ações de criação de workspace ficam fixas em um rodapé que não rola.
- **O fluxo do chat pula os nós do assistente que não renderizam nada.** Um nó finalizado do assistente cujos blocos são apenas cabeçalhos de chamada de ferramenta e texto/raciocínio em branco é retirado da derivação do fluxo, de modo que resultados de ferramenta consecutivos se fundem em um só grupo. Nós interrompidos sempre são renderizados (eles carregam o marcador Interrompido).
- **Os resumos das linhas de ferramenta relativizam os caminhos com raiz no workspace.** O cwd da sessão atravessa o contrato do slot de toolview (`ToolRowOwnerProps.cwd`), e `toolRowModel` o remove dos resumos que começam com ele; caminhos fora do workspace ficam inalterados. É só exibição: os args e o log ficam intocados.
- **A varredura de execução é uma sobreposição em faixa de brilho.** Uma faixa de gradiente `::after` de largura fixa se anima ao longo da linha (o padrão ShimmerText do deepsuite), substituindo a abordagem anterior com `mask-image`, tanto no ToolRow quanto no toolview de Bash.
- **O chip de workspace do hero é um seletor, não um eco.** Sem seleção ativa (inicialização a frio, ou o workspace foi excluído depois que a lista se estabilizou), ele mostra o placeholder "Choose workspace"; o nome derivado do cwd apenas cobre a carga inicial da lista, e escolhas pendentes desatualizadas são limpas quando o workspace delas sai de uma lista pronta.
- **Um único ritmo vertical de 16px.** O espaçamento da coluna do chat e o espaçamento entre linhas de ferramenta dentro do grupo são ambos de 16px, substituindo o espaçamento de 10px dentro do grupo somado a uma margem negativa entre grupos.
- **O título do cabeçalho usa 14/20, sem contador de turnos**; o estado em andamento do StateDot e a cauda do turno usam uma linguagem de carregamento em passos, com perseguição de pixels; `body` recebe antialiasing em escala de cinza (`-webkit-font-smoothing` e o equivalente do Firefox no macOS).

## Alternativas consideradas

- **Posicionar os menus de forma síncrona a partir dos retângulos da âncora, antes da montagem.** Rejeitada: o tamanho da própria lista é desconhecido até que ela faça o layout, então limitar à viewport ainda exige uma medição posterior ao layout; medir um nó montado e oculto é o padrão que o React e o Floating UI documentam.
- **Filtrar as mensagens vazias do assistente no lado do host.** Rejeitada: o nó é saída real do modelo, que o Trajectory e o replay precisam manter; só a apresentação do chat deve pulá-lo, e a camada web é pura apresentação por contrato.
- **Relativizar os caminhos no presenter de cada ferramenta.** Rejeitada: a redundância é compartilhada por toda ferramenta que resume caminhos; uma única passagem só de exibição em `toolRowModel` cobre todas, e os consumidores fora do chat mantêm os caminhos absolutos.
- **Manter a varredura baseada em máscara.** Rejeitada: a máscara escurece todo o conteúdo da linha, inclusive os pontos de estado, e sua transição de saída brigava com o crossfade do ícone no hover; uma faixa sobreposta é composta acima do conteúdo sem tocar no alfa dele.
- **Continuar mostrando o nome do workspace excluído no chip.** Rejeitada: o chip é o seletor da *próxima* sessão; ecoar um cwd cujo workspace o usuário acabou de excluir deturpa a escolha atual.

## Consequências

O chat renderiza menos itens de fluxo do que o snapshot tem de nós: quem contar blocos renderizados contra nós precisa considerar os nós do assistente pulados por não renderizarem nada (a spec de chat-view fixa isso). A relativização de caminhos é uma verificação de prefixo contra o cwd da sessão, então renomear o workspace no meio da sessão mostra caminhos absolutos até que o resumo seja derivado de novo, o que é aceito como desatualização restrita à exibição. O ritmo uniforme de 16px aposenta o visual mais apertado, de 10px, das sequências de ferramentas; um futuro layout mais denso reintroduziria uma segunda constante de forma deliberada. A pré-renderização do menu acrescenta uma passagem de layout oculta por abertura, desprezível nos tamanhos de menu.

## Testes

`chat-view.spec.tsx` fixa o agrupamento dos nós que não renderizam nada (inclusive a exceção dos interrompidos); `chat-tool-row.spec.tsx` fixa a relativização do cwd dentro e fora do workspace e com um cwd vazio; `atoms.spec.tsx` e `workspace-picker.spec.tsx` cobrem os estados do menu e do chip; as suítes completas de ui-conversation, ui-primitives e ui-workspace passam.
