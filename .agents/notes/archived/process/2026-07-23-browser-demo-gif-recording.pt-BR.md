# Agent Note: Gravação de GIFs de demonstração no navegador

Status: implemented
Archived: 2026-07-26

[English](2026-07-23-browser-demo-gif-recording.md) | Português

## Problema

As demonstrações no navegador vinham sendo montadas com comandos avulsos de captura e de codificação. Isso torna inconsistentes a temporização e o tamanho da saída, incentiva gravações contínuas que encobrem as mudanças de estado úteis e pode apagar a fronteira entre um fluxo genuíno de servidor ou de API e uma fixture (dados de teste pré-montados). Combinar a gravação local com o upload de anexos ou com a edição de pull requests também dá a uma tarefa de mídia uma autoridade de escrita remota que nada tem a ver com ela.

## Decisão

O repositório fornece a skill (habilidade) [`record-browser-gif`](../../../skills/record-browser-gif/SKILL.md) para artefatos locais de demonstração no navegador. Ela usa o workflow de controle de navegador disponível, estabelece se o fluxo pedido é real, apoiado em fixture ou simulado de outra forma, e captura um storyboard pequeno apenas depois de estados de UI semanticamente observáveis. Os frames ficam no diretório `.playwright-mcp/` do repositório, ignorado pelo Git (a ferramenta de navegador só escreve sob as raízes permitidas), e nunca sujam o worktree.

O helper `encode_gif.py` incluído ordena os frames lexicamente, atribui durações de permanência explícitas, usa um pipeline de paleta do `ffmpeg` e valida, por meio do `ffprobe`, as dimensões da fonte e também a contagem de frames, as dimensões, a duração e o limite de bytes do resultado codificado. A gravação termina depois de retornar o caminho absoluto verificado do GIF; quando a tarefa inclui anexar o GIF a um pull request, a [decisão de evidência em GIF para PRs de GUI](2026-07-26-gui-pr-gif-evidence-and-assets-branch.md) é dona da política de evidência obrigatória e da etapa de publicação no branch de assets que vem em seguida.

## Alternativas consideradas

**Gravar vídeo contínuo e convertê-lo depois.** A captura contínua preserva cada movimento do cursor e cada transição de carregamento, mas produz artefatos maiores e mais ruidosos e dificulta uma temporização determinística. Um storyboard de estados serve melhor às demonstrações curtas de funcionalidade, em que a evidência relevante é um punhado de transições visíveis.

**Manter uma receita inline de `ffmpeg` na skill.** Reconstruir a cada execução as aspas, os manifests (listas de metadados) de temporização, os filtros de paleta, o comportamento de sobrescrita e as verificações pós-codificação é propenso a erros. Um helper incluído mantém essa mecânica executável, enquanto a skill é dona do julgamento de captura.

**Incluir a anexação no GitHub e a edição da descrição.** O upload e a mutação remota exigem regras separadas de autenticação, de confirmação e de recuperação. Manter a gravação em si local e reversível preserva essa fronteira; a [decisão de evidência em GIF para PRs de GUI](2026-07-26-gui-pr-gif-evidence-and-assets-branch.md) é dona da etapa de publicação delimitada para as tarefas que de fato anexam o GIF a um pull request.

**Usar uma fixture sempre que ela for mais fácil de preparar.** As fixtures são válidas quando a demonstração pedida é explicitamente apoiada em fixture, mas não comprovam uma alegação de servidor real ou de API real. A skill preserva a procedência pedida e informa um pré-requisito ausente em vez de trocá-la em silêncio.

## Consequências

As gravações são artefatos locais pequenos e repetíveis, com procedência explícita e uma fronteira limpa com o repositório. O workflow abre mão do movimento contínuo e suave, depende de `ffmpeg` e `ffprobe` disponíveis localmente e exige que quem grava identifique os pontos de captura semânticos. O helper é exercitado contra uma demonstração de navegador com quatro estados e contra uma entrada de duração inválida; a forma da skill e os links do repositório são cobertos pelo validador de skills e pelas gates de documentação.
