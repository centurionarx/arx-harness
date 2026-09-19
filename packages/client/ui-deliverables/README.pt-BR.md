# @arx-ai/arx-client-ui-deliverables

[English](README.md) | Português

Responsável pelos arquivos produzidos e pelas referências clicáveis. A metade Node registra orientações para a resposta final no registro de system prompts; a metade do navegador registra a linha de entregas ao final de um turno no espaço `conversation.chat.turnTail` da visualização de chat e vincula referências correspondentes em código inline na prosa final. O patch Web distribuído é a única composição que carrega este pacote. Remover sua entrada única em cordis.yml remove conjuntamente as orientações, a linha e os links na prosa.

`deliverablesDefinition` acumula as chamadas de mutação bem-sucedidas e os eventos explícitos `deliverables/presented` de cada Turn em `DeliverablesTurnData`, publicado pelo mecanismo; `producedForClosing` lê esses dados com a sequência do Assistant final. Referências de arquivos vêm dos próprios `locations` de acompanhamento das ferramentas de mutação e da [ferramenta present](../../fs/tool-present/README.md), nunca da prosa final: um arquivo produzido é listado mesmo se o modelo esquecer de mencioná-lo. Uma mutação é reconhecida pela intenção de renderização, não pelo nome da ferramenta: um cartão de diff ou um cartão genérico cujo `kind` é `edit` (formato apresentado pela operação insert de `str_replace_editor`). Assim, uma ferramenta nova participa declarando o que faz. Leituras, exclusões e chamadas malsucedidas não contribuem; um caminho aparece uma vez por Turn, na ordem da primeira ocorrência. O índice Conversation Location é responsável pela associação ao Turn, impedindo que um Turn que muda arquivos e termina sem texto de conteúdo invada a linha do próximo Turn.

`ProducedFiles` renderiza a linha entre o corpo da mensagem final e seu rodapé IconActions: um rótulo discreto e uma faixa medida de arquivos. Mostra o maior prefixo inicial que cabe (até seis chips; nome-base como texto e caminho completo em `title`), reservando a largura exata do texto localizado `+ N files`, para que o restante permaneça visível sem quebra de linha ou rolagem horizontal. Cada chip abre por `openFile`, fornecido pelo proprietário: o mesmo mecanismo do Host usado pelas linhas de ferramentas, com o chat resolvendo caminhos relativos a partir do cwd da sessão. Quando há arquivos ocultos, uma ação **Mostrar na pasta** na segunda linha abre o workspace da sessão pelo mesmo caminho do proprietário apenas quando a página é loopback e o handshake atual do Host informa `canOpenPath`; acesso Web remoto direto e Hosts Linux headless ou em contêiner omitem a ação por padrão. Justificativa: a [Agent Note sobre links de arquivos do workspace](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md).

A prosa final usa o mesmo vocabulário. Este plugin fornece o serviço `chatFileMentions`, consultado pelo chat para cada mensagem final: `producedFileMentions` resolve um token em código inline pelo caminho exato ou por corresponder exatamente ao nome-base de um único caminho produzido. Um nome-base compartilhado por dois caminhos permanece inerte, sem adivinhação, de modo que um link de menção nunca abra o arquivo errado nem gere 404. Uma menção resolvida mantém seu chip de código e adota a aparência de link da folha Markdown: azul em repouso e sublinhado ao passar o cursor, como código inline promovido a URL, com o caminho completo em `title`; menções nunca são renderizadas dentro de âncoras nem em texto em streaming. Registro da decisão: a [Agent Note sobre menções inline de arquivos](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md).

A metade Node registra a seção estática `ui:deliverable-file-references` do system prompt. Ela pede ao modelo que mencione os arquivos principais criados ou modificados com sucesso e escreva essas referências e quaisquer outras referências a arquivos alterados como código inline Markdown, usando o caminho exato da ferramenta ou o nome-base somente quando único no Turn. As orientações explicitam a sintaxe aceita pelo renderizador; não governam discussões de caminhos não relacionados nem criam referências a partir da prosa.

## Experiência do modelo

### Orientações para referências clicáveis de arquivos

#### O que o modelo vê

Um parágrafo fixo instrui o modelo a nomear os arquivos principais de chamadas bem-sucedidas de criação ou modificação na resposta final e a formatar essas referências e quaisquer outras referências a arquivos alterados como código inline Markdown com caminho exato ou nome-base único, como `out/report.html`.

#### Efeito em tokens

Um parágrafo fixo de prompt sempre que o pacote estiver carregado; nenhum schema de ferramenta, resultado de ferramenta ou contexto por Turn é acrescentado.

#### Efeito no KV Cache

A seção é estática na ordem 190 durante toda a montagem do pacote, permanece no prefixo reutilizável do prompt e não muda entre Turns.

## Limitações conhecidas e trabalho adiado

- **A correspondência de menções usa apenas caminho exato ou nome-base único.** Uma menção por sufixo (`out/index.html` mencionado como `index.html` resolve; `deep/out/index.html` mencionado como `out/index.html` não resolve) permanece inerte; ampliar a correspondência fica adiado até haver um formato real de mensagem final que exija isso.
- **Arquivos criados indiretamente exigem apresentação explícita.** A ferramenta `present` os valida e registra antes da resposta final; apenas mencionar um caminho não relacionado não o acrescenta à linha. As referências preservam a grafia relativa à Session em replay e forks; o conteúdo atual dos arquivos permanece mutável.
- **A abertura nativa de pastas tem como destino o desktop do Host.** Um navegador acessado por autoridade não loopback omite a ação, assim como uma implantação que não informa mecanismo nativo de abertura. Encaminhamento SSH que faz um Host remoto parecer local por loopback deve configurar `nativeOpen: false` no gateway; o mesmo vale para um Host macOS/Windows headless, implantação WSL sem interoperabilidade Windows funcional ou desktop Linux cuja sondagem do mecanismo de abertura seja um falso positivo. Identificar o desktop visível ao operador continua sendo política da implantação.
