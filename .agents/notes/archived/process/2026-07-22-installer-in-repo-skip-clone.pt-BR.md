# Agent Note: o instalador pula o clone quando executado de dentro de um checkout

Status: implemented
Archived: 2026-07-26

[English](2026-07-22-installer-in-repo-skip-clone.md) | Português

## Problema

O `scripts/install.sh` foi escrito para o caminho `curl ... | sh`: ele clona o harness em `~/.dsh/source` e depois instala, cria os links e inicia. Os contribuidores que já têm um checkout e executam o mesmo script diretamente (`sh scripts/install.sh`) recebiam um segundo clone, sem relação com o primeiro, em `~/.dsh/source`, o que instalava e linkava uma árvore diferente daquela em que estavam trabalhando, sem nenhuma forma de exercitar o script local contra o código-fonte local.

## Decisão

O script detecta quando está executando de dentro de um checkout real e, nesse modo, reutiliza esse checkout e pula por completo a etapa de clone/atualização, deixando a árvore de trabalho intocada.

A detecção se baseia em `$0`: sob `curl ... | sh`, o texto do script chega pelo stdin, então `$0` é o nome do shell e nenhum caminho de arquivo resolve; executar uma cópia vinda do checkout faz de `$0` o arquivo do script. Quando `$0` é um arquivo legível cujo pai é um diretório `scripts/` dentro de uma árvore que carrega tanto o launcher `bin/dsh` quanto `scripts/install.sh`, o script define `IN_REPO=1` e reaponta `DSH_SOURCE` para a raiz desse repositório. A etapa 2 então imprime uma linha "using existing checkout" e não faz mais nada: nem `git fetch`, nem `git checkout -B`, de modo que a árvore de trabalho e o branch do usuário nunca são alterados. `DSH_REF` é consultivo e ignorado nesse modo.

Um `DSH_SOURCE` explícito prevalece sobre a detecção: o valor é capturado antes da aplicação do padrão, e a detecção dentro do repositório só reaponta um `DSH_SOURCE` não definido (ou um que já seja igual à raiz do repositório detectada). Definir `DSH_SOURCE` para um diretório diferente faz voltar ao caminho normal de clone/atualização, então a saída de emergência para instalar uma árvore separada de dentro de um checkout continua existindo.

## Alternativas consideradas

**Detectar via `git rev-parse --show-toplevel` no diretório atual.** Rejeitada: `curl ... | sh` roda com frequência de dentro de algum repositório git sem relação (o `cwd` do usuário), o que daria falso positivo e pularia o clone contra uma árvore que não é o dsh. Ancorar na localização do próprio `$0` amarra a decisão ao lugar onde o script fisicamente vive, e os marcadores `bin/dsh` + `scripts/install.sh` confirmam que se trata mesmo de um checkout do dsh.

**Sempre pular o clone quando executado a partir de um arquivo, ignorando `DSH_SOURCE`.** Rejeitada: um contribuidor pode legitimamente executar o script de dentro do repositório para provisionar uma instalação separada em `~/.dsh/source`; respeitar um `DSH_SOURCE` explícito diferente do checkout preserva esse caminho.

## Consequências

Executar `sh scripts/install.sh` a partir de um checkout agora instala, linka e inicia esse checkout em vez de clonar um paralelo, o que também torna o script local testável contra o código-fonte local. O custo é um bloco de detecção acoplado ao layout do repositório (`scripts/` ao lado de `bin/dsh`); se o launcher ou o script mudarem de lugar, os marcadores precisam mudar junto. O comportamento está documentado no cabeçalho do script e nos dois arquivos README, e foi verificado com a execução dos quatro caminhos (pulo dentro do repositório, clone no estilo curl, `DSH_SOURCE` explícito em outro lugar voltando ao clone, `DSH_SOURCE` explícito igual à raiz do repositório ainda pulando).
