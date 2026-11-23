# Agent Note: Autocompletar de referências a arquivos na TUI

Status: implemented
Archived: 2026-08-04

[English](2026-07-23-tui-file-reference-autocomplete.md) | Português

## Problema

A TUI oferecia referências estruturadas `@session`, mas nenhuma forma confiável de descobrir caminhos do workspace durante a escrita de um prompt. Exigir que os usuários lembrassem caminhos exatos tornava os pedidos voltados a arquivos desnecessariamente incômodos, enquanto anexar antecipadamente todo arquivo selecionado gastaria contexto antes de o modelo saber se o conteúdo era relevante e esconderia do transcript (registro textual da sessão) de ferramentas a observação normal de `read`.

## Decisão

A TUI é dona de um índice de caminhos do workspace do host, limitado e cancelável, com raiz no diretório de trabalho da sessão ativa. Digitar `@` em um limite de token faz a correspondência aproximada de arquivos e diretórios; consultas que contêm `/` listam diretamente o diretório nomeado, aceitar um diretório continua o autocompletar, e caminhos com espaços em branco usam a forma `@"path with spaces"`. A configuração controla a quantidade de resultados, o tamanho do índice e os nomes-base de diretórios excluídos. As exclusões padrão são `.git` e `node_modules`; a travessia não segue symlinks de diretório nem interpreta arquivos de ignore.

Selecionar um arquivo altera apenas o texto do editor. A mensagem de usuário enviada mantém a grafia natural `@path` e não carrega conteúdo injetado, contexto oculto nem objeto de referência. Quando a ferramenta `read` voltada ao modelo está registrada, a TUI contribui com uma seção estável de prompt de sistema que identifica os caminhos com `@` como referências explícitas do usuário, orienta o modelo a chamar `read` quando o conteúdo for necessário e proíbe alegar inspeção antes dessa chamada. Os resultados de ferramenta invalidam o índice aproximado reutilizável, para que as interações seguintes observem as prováveis mutações do workspace.

As menções estruturadas de sessão mantêm sua preparação de snapshot atual. Ao contrário dos arquivos, uma sessão referenciada não tem ferramenta geral de recuperação voltada ao modelo, então reduzir `@session` a um rótulo parecido com caminho tornaria seu conteúdo inalcançável.

## Alternativas consideradas

**Injetar antecipadamente o conteúdo dos arquivos selecionados.** Isso gasta tokens antes de a relevância ser conhecida, pode capturar conteúdo desatualizado antes de a execução chegar à referência e contorna a sequência auditável de chamada/resultado de `read`.

**Exigir um localizador de arquivos externo.** Depender de `fd`, `rg --files` ou outro executável faria o autocompletar básico variar conforme a instalação do host e complicaria o cancelamento e o comportamento entre plataformas.

**Usar a operação comum de listagem de diretório do serviço de sistema de arquivos para a descoberta.** Esse seam é otimizado para operações exatas de sistema de arquivos voltadas ao modelo e pode representar um namespace remoto; a indexação aproximada recursiva multiplicaria as idas e voltas ao provedor e acoplaria a latência do editor à política de ferramentas. A descoberta do lado do host mantém a interação de terminal local, enquanto a limitação documentada de alinhamento de namespace permanece explícita para deploys não locais.

**Adicionar uma nova capacidade de busca de arquivos entre pacotes.** A TUI é o único consumidor atual, e o comportamento é apresentação de editor, não uma capacidade do modelo, então um novo conjunto de pacotes de interface, implementação e consumidor dividiria o seam prematuramente.

## Consequências

Os usuários podem descobrir e inserir caminhos sem que a seleção em si se torne cara ou visível ao modelo além do caminho. O modelo preserva a autonomia de decidir se inspeciona um arquivo, e qualquer inspeção permanece reconstruível pelo transcript de ferramentas registrado no log. A instrução fixa aumenta levemente os prompts de sistema da TUI quando `read` está presente, e os pedidos que exigem conteúdo custam uma ida e volta de ferramenta adicional.

O autocompletar é deliberadamente limitado e consultivo: workspaces muito grandes podem omitir caminhos além do teto de índice configurado, arquivos ignorados ainda podem aparecer, e deploys com sistema de arquivos remoto ou virtual precisam alinhar o diretório de trabalho do host da TUI ao namespace de `read` ou fornecer outra superfície de autocompletar. Os testes de pacote fixam a gramática de tokens, o ranqueamento, os limites, o cancelamento, a invalidação, o envio só do caminho, o menu visível e o autocompletar por teclado; um deploy que distribui a TUI é dono de sua aceitação de Loader e de PTY.
