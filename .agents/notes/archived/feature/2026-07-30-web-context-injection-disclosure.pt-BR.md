# Agent Note: Disclosure da injeção de contexto na Web

Status: implemented
Archived: 2026-08-07

[English](2026-07-30-web-context-injection-disclosure.md) | Português

## Problema

A conversa da Web renderizava toda mensagem registrada em log que não fosse do usuário por meio do `JsonBlock` genérico. Essa apresentação usava um triângulo textual, tipografia compacta de rótulo, um painel JSON com borda e espaçamento não relacionado, de modo que a injeção de contexto não correspondia ao disclosure de Tool calls mostrado no design do produto. Reestilizar a primitiva genérica também alteraria eventos desconhecidos e fallbacks de anexos.

## Decisão

`MessageItem` encaminha os nós de contexto para `ContextInjectionRow`. A linha começa recolhida, nomeia a apresentação como `Injeção de contexto`, usa o glifo de navegação (browse) existente e expõe todo o cabeçalho de 24px como um único alvo de disclosure por ponteiro e por teclado. O corpo expandido começa 4px abaixo do cabeçalho, no recuo de conteúdo compartilhado de 22px, e renderiza a área de rolagem de 141px do design, com raio de 8px, fundo de bloco de código, texto de código 11/16 e sem borda.

`ContextInjectionRow` serializa tanto o `content` quanto o `source` registrados em log em um único valor JSON inline, preservando a proveniência ao lado do material visível ao modelo. A exibição continua limitada pela política de truncamento existente de 20.000 caracteres. Ela não altera nenhum evento de sessão, fold de runtime ou plugin produtor de contexto.

O `DisclosureRow`, interno ao pacote, é dono da geometria do cabeçalho, da transição de ícone para chevron, do estado aberto controlado e do comportamento de Enter/Espaço compartilhados pelo contexto e por `ToolRow`. `ToolRow` continua sendo o dono semântico do estado da ferramenta, dos resumos, dos links de arquivo e dos corpos expandidos de ferramenta. O contexto não entra no slot de toolview com chave e não ganha nenhum slot específico de contexto enquanto todas as fontes de contexto compartilharem uma única apresentação.

## Verificação

Os testes de componente da conversa fixam o padrão recolhido, o glifo de navegação, as alternâncias por ponteiro e por teclado na linha inteira, o formato do JSON inline, o truncamento e a renderização genérica inalterada de eventos desconhecidos. O cenário sem chave de histórico da Web montada injeta contexto pela Agent API real, registra a linha recolhida em seu golden de ARIA e mede no Chromium o ícone, o cabeçalho, o recuo, o espaçamento, a área de rolagem, o padding, o raio, a tipografia, a cor e o overflow do design.

## Alternativas consideradas

**Reestilizar `JsonBlock` globalmente.** Eventos de superfície desconhecidos e blocos de conteúdo diversos usam essa primitiva como um fallback genérico separado, então uma mudança visual global acoplaria apresentações sem relação entre si.

**Renderizar o contexto como uma ferramenta de leitura.** Reutilizar `ToolRow` diretamente acrescentaria semântica falsa de ferramenta, estado e dispatch com chave a uma mensagem registrada em log que não é do usuário.

**Adicionar um slot de context-view com chave.** Toda fonte de contexto atual usa o mesmo título e o mesmo corpo de proveniência. Um seam de registro não tem consumidor hoje e pode ser adicionado sem mudar a linha caso surjam apresentações distintas pertencentes a cada fonte.

## Consequências

A injeção de contexto corresponde à linguagem visual de Tool calls sem alterar seu significado durável. O cabeçalho de disclosure compartilhado impede que as duas linhas divirjam, enquanto o corpo de contexto dedicado e o `JsonBlock` genérico continuam podendo evoluir de forma independente. O corpo de altura fixa troca a expansão automática por um ritmo estável do transcript (registro textual da sessão) e exige rolagem para inspecionar instruções injetadas longas.
