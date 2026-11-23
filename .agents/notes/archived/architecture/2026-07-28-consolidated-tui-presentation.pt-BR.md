# Agent Note: Apresentação e navegação consolidadas da TUI

Status: implemented
Archived: 2026-08-04

[English](2026-07-28-consolidated-tui-presentation.md) | Português

## Problema

A interface de terminal acumulou regras de apresentação independentes que interagiam mal: papéis da paleta eram aliases uns dos outros ou invertiam a ênfase em terminais claros; a moldura, a saída e os marcadores de saída dos cartões de ferramenta se repetiam ou competiam; o contexto injetado era parseado como XML e não conseguia ser recolhido de forma confiável; e `/resume` excluía sessões fora do workspace atual mesmo quando o launcher conseguia alcançá-las. Cada sintoma parecia local, mas a decisão durável é um único modelo de leitura no terminal: uma paleta pequena e inspecionável, cartões guiados pelo status com corpos recuados, recolhimento do transcript (registro textual da sessão) independente do conteúdo e navegação ciente do workspace.

## Decisão

### Paleta

`paletteSpec(scheme)` é a tabela única de códigos SGR, códigos de fechamento e finalidades. `createPalette` deriva dela todos os wrappers e `/palette` imprime a mesma tabela no terminal em execução. Os componentes não emitem as próprias sequências SGR, exceto o gradiente fixo da marca na inicialização. Todo fechamento redefine cada grupo SGR que a abertura correspondente define.

Os papéis duplicados são unificados: `muted` em `dim`, `added` em `success`, `removed` em `error`, e o segundo accent, sem uso, é removido. `dim` usa `2;39` e fecha com `22;39` nos dois esquemas, para que o texto recuado permaneça relativo à cor de primeiro plano do terminal em vez de virar um cinza pesado fixo em fundos claros. Cores e atributos recebem brands separados no TypeScript, o que permite a composição atributo/cor e rejeita cores aninhadas cujo reset descartaria a cor externa.

### Cartões de ferramenta

Um cartão de ferramenta tem um cabeçalho de status colorido `Tool / <name>` sobre um corpo dim. Os títulos do presenter, os comandos de terminal e as linhas de cwd, a saída, o texto XML e os marcadores de recolhimento usam esse tom de corpo. As cores de diff permanecem porque vermelho e verde carregam significado, e os marcadores de sinal continuam sendo erros.

`renderUnknownXml` recebe um estilizador de corpo explícito para resultados de ferramentas desconhecidas. Os presenters de terminal parseiam e removem o marcador final de saída ou de sinal voltado ao modelo antes de retornar `TerminalResultView.output`; a TUI renderiza o status estruturado uma única vez, como um pill próprio. As linhas de truncamento, timeout e sandbox permanecem no corpo porque o pill não as representa.

### Contexto injetado e recolhimento

O contexto injetado é renderizado como prosa em `ContextCardComponent`, não pelo renderizador de árvore XML. As linhas externas `<system-reminder>` com correspondência exata são removidas, mas texto semelhante a tags que esteja desencontrado, sem par ou inline permanece verbatim. O conteúdo voltado ao modelo não muda. O recolhimento usa o helper compartilhado `preview` depois da montagem do corpo, então depende apenas da contagem de linhas, nunca do sucesso do parser nem dos caracteres do payload.

`Ctrl+O` alterna entre recolhido, expandido e oculto. No estado oculto, os cartões de ferramenta desaparecem junto com o espaçamento inicial que pertence ao cartão. Os cartões de contexto participam dos estados recolhido e expandido, mas voltam ao recolhido enquanto as ferramentas estão ocultas, porque instruções injetadas não são tráfego de ferramenta descartável. A fase oculta também recolhe as etapas do assistente de cada turno em uma única mensagem; a [Agent Note do recolhimento do assistente no modo oculto](../feature/2026-07-29-tui-hidden-mode-assistant-fold.md) é a dona dessa regra.

### Retomada entre workspaces

O seletor de retomada resume todos os registros e é dono de um escopo workspace atual/todos os workspaces, alternado com Tab. Ele abre no workspace atual, adiciona rótulos de workspace apenas no escopo mais amplo e recusa registros sem cwd porque não há diretório em que entrar.

`TuiResumeHost.handoff` recebe o `SessionId` selecionado e o cwd relido durante o preflight. A CLI (interface de linha de comando) muda de diretório antes de fazer o dispose (liberação de recursos) do app atual, então um diretório inalcançável falha enquanto o terminal ainda consegue se recuperar; depois, `execve` herda o workspace selecionado. O launcher também fornece a mensagem de saída, em vez de pedir à TUI que reconstrua a sintaxe do launcher.

## Alternativas consideradas

**Manter notas separadas e correções locais para cada sintoma visual.** Rejeitada: as decisões compartilham uma única hierarquia de leitura e se substituíram repetidamente. Um único dono deixa claras as regras finais de paleta, cartão, contexto e navegação sem exigir que os leitores reconstruam a cronologia.

**Manter os aliases e impor a apresentação por convenção.** Rejeitada: aliases sugerem distinções que não existem, e resets de cores aninhadas ou fechamentos SGR incompletos falham em silêncio. Uma tabela única mais os tipos torna o contrato inspecionável e verificado mecanicamente.

**Preservar a separação de cores entre moldura e saída dentro dos cartões de ferramenta.** Rejeitada: os cartões reais misturavam a cor de primeiro plano padrão, comandos em ciano, cwd dim, XML sem estilo e saída dim. O cabeçalho de status já fornece a âncora de leitura rápida; um único corpo recuado remove o ruído. As cores de diff são a exceção semântica estreita.

**Parsear ou reparar o contexto injetado como XML.** Rejeitada: as molduras de reminder são convenções de prompting em torno de prosa arbitrária que contém e comerciais crus, comparações e sinais de menor e maior usados como placeholder. Repará-la ou escapá-la significaria adivinhar a estrutura ou alterar o texto visível ao modelo.

**Ocultar os cartões de contexto junto com os cartões de ferramenta.** Rejeitada: o contexto carrega instruções injetadas, não detalhes de execução recuperáveis. Por isso a fase oculta remove apenas o tráfego de ferramenta.

**Manter a retomada restrita a um workspace ou inferir o cwd depois do boot.** Rejeitada: a restrição força um relançamento manual, e o cwd restaurado do cabeçalho não controla a resolução do sistema de arquivos nem do shell. O diretório de destino precisa atravessar o seam do host antes da substituição do processo.

**Descartar o pill de saída da TUI ou remover os marcadores de saída voltados ao modelo.** Rejeitada: o pill é o status de UI que se lê de relance, enquanto o marcador de texto é o sinal de status do modelo. O presenter consome o marcador ao construir a visão estruturada, de modo que os dois públicos recebem uma única representação.

## Consequências

O transcript é lido como cabeçalhos de status coloridos sobre detalhes recuados, a apresentação do contexto é estável para prosa arbitrária e um único atalho controla a densidade do transcript. O papel público `TuiTheme.muted` é removido; as extensões usam `dim`. Os contratos da paleta e de `renderUnknownXml` são mais estritos, o que adiciona um pequeno atrito em tempo de compilação em troca de evitar a perda silenciosa de estilo.

A retomada entre workspaces pode mover para outro diretório toda ferramenta que resolve caminhos. Um cwd ausente ou inacessível impede o handoff. O seletor mais amplo também torna mais fácil chegar ao acesso concorrente a um store de sessões compartilhado; o bloqueio de sessão entre processos continua sendo um trabalho separado.

O presenter de terminal ainda trata como status estruturado uma linha final de saída que corresponda exatamente à gramática do marcador de saída, então um comando que imprime intencionalmente uma linha assim pode perdê-la do corpo do cartão. Esse resíduo está documentado em `dsh-tool-bash`.

## Testes

Os testes unitários da TUI e os snapshots de terminal sem chave cobrem a enumeração da paleta, os papéis claro/escuro, a composição de estilos legal e ilegal, os corpos de cartão uniformemente dim, as cores semânticas de diff, a saída de terminal sem marcador com um único pill de saída, as molduras de contexto que preservam a prosa, o recolhimento independente do conteúdo, o ciclo de três estados do Ctrl+O, a filtragem de modelos e os dois escopos de retomada. Os testes de handoff da CLI cobrem a passagem do cwd relido e a rejeição de uma falha ao entrar no diretório antes do teardown. Os testes do tool-bash fixam a emissão, o parse e a remoção do marcador de resultado como uma única ida e volta.
