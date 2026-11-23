# Agent Note: O QuestionDialog da TUI renderiza opções em várias linhas

Status: implemented
Archived: 2026-08-04

[English](2026-07-24-tui-question-dialog-multiline.md) | Português

## Problema

`ctx.userInteraction.ask()` precisa manter legíveis o texto da pergunta, o `detail` de apoio, os rótulos das opções, as descrições, a validação e os controles dentro dos limites configurados de largura e altura. O painel da pergunta também deve ficar logo acima do editor: colocá-lo na borda do terminal separa a decisão pendente tanto do transcript (registro textual da sessão) que a motivou quanto da entrada que vem depois dela.

## Decisão

A TUI renderiza uma pergunta pendente como um modal inline entre a área de transcript/status e o editor, mantendo o FIFO compartilhado com os overlays de modelo e de plugin:

- `InlineModalComponent` aplica `questionDialogWidth` e `questionDialogMaxHeight` dentro do fluxo normal de componentes. A altura efetiva da pergunta é ainda limitada ao viewport atual depois de reservado o espaço do editor, então o editor permanece abaixo da pergunta durante o redimensionamento.
- `renderOptionBlock` quebra cada rótulo abaixo do seu prefixo de cursor/número e renderiza a descrição esmaecida em linhas quebradas separadamente e com o mesmo recuo. O cabeçalho de progresso, a pergunta, a dica de resposta personalizada, o texto de validação e as linhas finais também são limitados pela largura; o corte final com reticências é apenas um limite de segurança para prefixos ou outro conteúdo indivisível. O fallback explícito `↑ N lines hidden` fica reservado para um viewport abaixo do mínimo configurado, no qual o layout semântico inteiro não cabe.
- Quando o texto da pergunta ou o `detail` excede o espaço alocado ao cabeçalho, o cabeçalho vira um viewport de linhas paginado com sua própria linha de status `… lines A-B/N • PgUp/PgDn`. Page Up e Page Down percorrem os dois viewports de linhas: a navegação para a frente esgota as páginas de cabeçalho/detail antes de entrar nas páginas de uma opção selecionada grande demais, e a navegação para trás inverte essa ordem. Isso mantém alcançável o detail da revisão de plano em vez de deixá-lo atrás do limite de altura.
- O orçamento de linhas de opção subtrai as linhas de padding, cabeçalho, posição e rodapé antes de `windowBlocks` rodar. A janela obedece tanto a `maxQuestionOptions` quanto ao orçamento de linhas restante, mantém a opção selecionada visível e renderiza as opções omitidas como marcadores `↑ N more` / `↓ N more`. Se o chrome fixo deixasse menos de quatro linhas de opção, o cabeçalho compacto vira o paginador de linhas, para que o conteúdo selecionado, o status de paginação e os dois marcadores de opção ainda caibam.
- Quando um bloco selecionado excede o espaço que lhe foi alocado, ele vira um viewport de linhas com uma linha de status `lines A-B/N • PgUp/PgDn`. Page Up e Page Down expõem todas as linhas quebradas sem permitir que o bloco esconda os marcadores de opção, a validação ou os controles.

Os testes de pacote fixam os limites de contagem e de altura, a ordem de paginação do cabeçalho e do bloco selecionado, a quebra em larguras estreitas, o comportamento de seleção e o posicionamento em relação à entrada retida do editor. Os snapshots semânticos da TUI fixam o layout de terminal da aplicação montada, as transições de página de cabeçalho/detail e de opção selecionada e o estado de validação.

## Alternativas consideradas

**Truncamento horizontal só com reticências.** Manter uma opção por linha sinalizaria texto perdido sem tornar a descrição legível e não trataria os limites verticais. A implementação quebra o conteúdo legível e mantém as reticências apenas como limite final de segurança.

**Quebrar o rótulo e a descrição combinados.** Uma linha composta acopla as larguras dos dois, então qualquer um dos lados pode deixar o outro sem espaço. Linhas separadas mantêm as duas larguras previsíveis.

**Manter a pergunta como um overlay na borda inferior.** Uma âncora na borda do terminal pode colocar o painel depois do editor ou cobrir o chrome inferior, dependendo da altura do transcript e do viewport. O modal inline preserva a ordem, enquanto o gerenciador de modais mantém a posse do foco e do FIFO.

**Empurrar os limites para dentro do pi-tui.** O fatiamento genérico de overlays não consegue identificar os limites das opções, o conteúdo selecionado, os controles nem a relação com o editor inline. Por isso o dialog dono da pergunta aplica as regras semânticas de contagem, de linhas e de paginação.

**Usar apenas o limite de contagem de opções.** `maxQuestionOptions` continua sendo um limite público de contagem, mas sozinho não consegue conter blocos quebrados. O dialog aplica os limites de contagem e de linhas em conjunto.

## Consequências

- As descrições consomem linhas adicionais, então menos opções do que `maxQuestionOptions` podem ficar visíveis; os marcadores informam as contagens de opções omitidas.
- Textos de pergunta longos e o detail da revisão de plano continuam alcançáveis dentro de um painel de altura limitada, ao custo de compartilhar Page Up e Page Down com a paginação da opção selecionada.
- Um bloco selecionado grande demais reserva uma linha de status e exige Page Up ou Page Down para ler além da página de linhas atual.
- A pergunta inline pode deslocar linhas mais antigas do transcript para fora de um viewport curto. Abaixo da altura mínima configurada, o fallback final pode recolher as linhas superiores atrás de um marcador explícito de linhas ocultas, para que os controles de entrada e o editor continuem disponíveis.
- O schema voltado ao modelo, os rótulos selecionados, o comportamento de abort/cancelamento e o caminho de elicitação do ACP (Agent Client Protocol) não mudam.
