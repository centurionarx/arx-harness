# Agent Note: Evidência em GIF para pull requests de GUI e publicação em branch de assets

Status: implemented
Archived: 2026-07-27

[English](2026-07-26-gui-pr-gif-evidence-and-assets-branch.md) | Português

## Problema

Um pull request que muda o que um usuário do produto vê na GUI é, sem isso, revisado por meio de prosa e de nomes de testes, e nenhum dos dois mostra o resultado renderizado. A skill (habilidade) de [gravação de GIF de demonstração no navegador](../../../skills/record-browser-gif/SKILL.md) produz GIFs locais fiéis, mas parava deliberadamente no artefato local, então cada pull request que queria mostrar um GIF deduzia de novo, por conta própria, como publicá-lo. E commitar o GIF no branch do pull request nunca é aceitável, porque mídia binária no histórico incha para sempre todo clone futuro.

O próprio procedimento de gravação também vinha sendo reaprendido falha a falha: capturas de tela gravadas fora das raízes permitidas da ferramenta de navegador, ou em diretórios inexistentes, falham no momento da captura; estados transitórios de UI consultados em chamadas de ferramenta separadas se perdem, porque o turno se acomoda entre as chamadas; predicados de conclusão por substring coincidem com o eco do prompt do próprio usuário; e uma atribuição de variável de ambiente inline no comando do codificador é expandida tarde demais para surtir efeito.

## Decisão

Todo pull request que muda um comportamento de GUI visível ao usuário do produto inclui um GIF de demonstração gravado com a [skill record-browser-gif](../../../skills/record-browser-gif/SKILL.md), com procedência real (um servidor real inicializado a partir da árvore do branch do próprio pull request, uma chave de API real e rounds reais do modelo) declarada ao lado do embed. A procedência de fixture (dados de teste pré-montados) é aceitável apenas quando o usuário a pediu explicitamente.

O GIF é publicado em um branch órfão dedicado de assets (sem commit pai, só mídia), nunca no branch do pull request; um único branch de assets atende a uma série inteira de pull requests (branches existentes: `code-mode-ui-assets`, `pr-613-assets`). A publicação trabalha em um clone temporário raso, de branch único, faz o commit como `assets: <what it shows> gif (#<pr>)`, e o corpo do pull request incorpora a URL do blob com o sufixo obrigatório `?raw=true`. Os branches de assets são append-only: os corpos de pull requests com merge feito referenciam suas URLs para sempre, então um branch de assets nunca é reescrito nem excluído.

A gravação em si continua sem efeitos colaterais; a publicação é uma etapa final delimitada, que a skill executa apenas quando a tarefa inclui anexar o GIF a um pull request. A [skill record-browser-gif](../../../skills/record-browser-gif/SKILL.md) continua sendo o contrato vigente para a metade de gravação.

A skill incorpora as lições operacionais que a gravação rendeu: os quadros ficam em `.playwright-mcp/`, ignorado pelo `.gitignore` do repositório e criado antes da captura, porque a ferramenta de navegador grava apenas dentro de suas raízes permitidas e resolve nomes relativos a partir da raiz do repositório; cada pull request prepara a própria árvore construída, com um workspace temporário novo e uma sessão nova por cenário, e os servidores são encerrados por PID, e não por um padrão amplo de nome de processo; os estados transitórios são capturados conduzindo uma operação lenta em primeiro plano e consultando um marcador concreto do DOM dentro de uma única chamada de script de navegador; os predicados de conclusão comparam um elemento de texto exato, e não uma substring; e o codificador roda com `GIF_SKILL_DIR` exportado em uma linha própria, com durações por quadro que mantêm o estado acomodado por mais tempo, e com uma verificação do resumo em JSON e também uma leitura visual do GIF codificado.

## Alternativas consideradas

**Commitar o GIF no branch do pull request.** Mídia binária que entra por merge no branch padrão fica no histórico para todo clone e fetch futuro; o valor de um GIF de demonstração termina na revisão, enquanto o custo dele nunca termina.

**Anexar o GIF como um upload do GitHub.** Os uploads `user-attachments` por arrastar e soltar não estão disponíveis para um workflow de linha de comando, não podem ser recriados nem auditados a partir do repositório e deixam o ciclo de vida da mídia fora do controle do repositório.

**Armazenar os GIFs com Git LFS.** O LFS ainda acopla a mídia ao histórico do branch de código, adiciona uma dependência de infraestrutura a todo clone e a todo fetch de CI, e não oferece nada além do que já oferece um branch isolado, que o git comum já suporta.

**Um branch de assets por pull request.** Um branch por pull request espalha o namespace de refs e multiplica os clones temporários durante uma série; um branch por série mantém a publicação em um único push e continua isolado do histórico de código.

**Manter a publicação fora da skill de gravação.** Esse era o estado anterior; ele preservava uma fronteira limpa, mas fazia cada pull request deduzir de novo o mesmo procedimento. A fronteira sobrevive como uma condição explícita (a publicação roda apenas quando a tarefa inclui anexar o GIF a um pull request), e não como omissão.

**Deixar o GIF opcional por pull request.** Evidência opcional desaparece sob pressão de prazo exatamente onde mais importa; uma mudança de GUI revisada sem gravação pede aos revisores que imaginem o resultado renderizado ou que reconstruam o branch por conta própria.

## Consequências

Todo pull request de GUI carrega evidência visual com procedência declarada, e os revisores veem a mudança sem reconstruir o branch. O histórico do repositório fica livre de mídia; o custo passa para branches de assets append-only, que crescem para sempre, continuam baratos de clonar de forma rasa e nunca podem ser excluídos. A gravação obrigatória com procedência real adiciona um round com chave real e modelo real ao workflow de todo pull request de GUI, o que é deliberado, porque essa execução é a evidência. A metade de gravação continua reversível localmente, e um pedido de GIF cuja tarefa não inclui anexá-lo a um pull request ainda termina no artefato local verificado.
