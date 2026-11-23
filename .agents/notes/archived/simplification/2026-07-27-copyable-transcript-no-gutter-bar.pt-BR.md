# Agent Note: transcript copiável na TUI, sem barras de margem

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-copyable-transcript-no-gutter-bar.md) | Português

## Problema

A TUI agrupava os prompts do usuário e os cartões de ferramenta atrás de uma barra colorida na margem esquerda (`▌ `), anteposta a cada linha do corpo, e recuava os blocos do assistente e do sistema em uma coluna. Ambos são prefixos por linha: uma seleção por arraste do mouse do terminal sobre o scrollback captura o `▌ ` inicial ou o espaço inicial de cada linha, então o copiar e colar de uma mensagem, da saída de uma ferramenta ou de um bloco de código traz junto uma decoração que o usuário precisa remover à mão. A barra era o único separador por mensagem do transcript, então não podia simplesmente ser retirada sem outra forma de distinguir as mensagens.

## Decisão

O scrollback não carrega nenhum prefixo por linha. As mensagens são separadas apenas por um cabeçalho de papel em negrito e sublinhado, na cor do papel, e pelo espaçamento de linhas em branco, ambos já inseridos pelo terminal ao redor de cada bloco. O sublinhado dá a cada papel uma faixa visual distinta sem preenchimento de fundo, então ele funciona em qualquer tema de terminal e nunca entra na área de transferência:

- Os prompts do usuário e de steering (`UserMessageComponent`) são um `Container` simples: uma linha de cabeçalho `You` / `Steering` em negrito, sublinhada e na cor de destaque (por meio do helper compartilhado `messageHeader`), e depois o corpo do prompt na coluna 0.
- Os blocos do assistente renderizam um cabeçalho `Assistant` em negrito e sublinhado, depois o raciocínio e o texto na coluna 0, com a linha de tempo no fim do bloco (o antigo recuo `paddingX = 1` se foi).
- Os cartões de ferramenta abandonam o wrapper `GutterBox`. O status do cartão (pendente / erro / sucesso) colore a linha de título inteira: o glifo de status (`◌` / `✕` / `✓`) e o texto do título compartilham uma só cor, em negrito e sublinhados para combinar com os cabeçalhos de papel, em vez de uma barra colorida ao lado de um título sem cor. O corpo é renderizado sem prefixo; as linhas do corpo ainda passam por `Text` na largura do terminal, para que a saída bruta de ferramenta longa demais quebre a linha em vez de transbordar.
- A classe `GutterBox` é excluída; nada mais a usava.

Uma seleção por arraste sobre qualquer uma dessas regiões agora copia exatamente o texto da mensagem.

## Alternativas consideradas

- **Manter a barra só nas mensagens do usuário e retirá-la dos cartões de ferramenta** — deixa a saída de ferramenta, a região mais copiada, ainda poluída. Rejeitada: o objetivo é um transcript inteiramente copiável.
- **Uma única régua ou barra superior só na linha de cabeçalho** — o corpo é copiado limpo, mas selecionar o cabeçalho ainda captura um glifo, e isso reintroduz um caractere de decoração sem ganho de distinção sobre o cabeçalho de papel sublinhado.
- **Recuar os corpos agrupados em vez de usar uma barra** — os espaços iniciais ainda entram na área de transferência, então não resolve o problema da cópia; explicitamente descartada.
- **Uma faixa de fundo preenchida no cabeçalho** (vídeo reverso, ou um fundo suave de 256 cores) — dá a cada papel um bloco de cor forte, mas o preenchimento ANSI saturado fica pesado demais e os tons de 256 cores são fixos, e não remapeados pelo tema. O sublinhado dá a distinção por papel com uma presença bem mais leve.

## Consequências

- O copiar e colar a partir do scrollback sai limpo, sem pós-processamento pelo usuário. Esse foi o ganho que motivou a mudança.
- O transcript fica mais plano do que no layout com barra de margem, mas o cabeçalho em negrito e sublinhado de cada papel, na cor do papel, somado ao espaçamento de linhas em branco, mantém claras as fronteiras entre mensagens sem nenhum preenchimento na borda esquerda. O status dos cartões de ferramenta continua legível por meio do glifo e do título coloridos e sublinhados.
- As bordas de desenho de caixa (`│`) nas sobreposições transitórias (painel de status, seletor de modelo, lista de retomada) ficam intocadas. Elas não são conteúdo de mensagem do scrollback e raramente são copiadas.
- Os snapshots `*.expected.txt` da TUI afetados, que rodam sem chave, foram regravados por replay de fixtures (não é preciso chave de API; as sessões de LLM gravadas não mudam, só a renderização difere). A inicialização interativa e um prompt de ida e volta foram verificados no tmux.
