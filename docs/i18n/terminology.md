# Terminology

Esta tabela fixa a tradução unificada dos termos técnicos entre inglês e português do Brasil neste repositório.

**Regras gerais:**
- A coluna "Português" traz a palavra usada por padrão na prosa em português. Quando essa coluna repete o termo em inglês, a prosa em português mantém o inglês sem traduzir.
- A primeira ocorrência segue a coluna "Primeira ocorrência" (com a anotação entre parênteses); as ocorrências seguintes escrevem só a parte anterior aos parênteses (em português ou em inglês, conforme a linha), sem repetir a anotação.
- A coluna "Não traduzir como" lista renderizações estritamente proibidas.
- Se o termo já foi anotado como parte de outro termo (por exemplo, `compactação de contexto (context compaction)` já contém a anotação de `compaction`), ele dispensa nova anotação quando aparecer sozinho depois disso.

## Classe de siglas (os dois idiomas usam a sigla)

| English | Português | Primeira ocorrência | Não traduzir como | Notas |
|---|---|---|---|---|
| ACP | ACP | ACP (Agent Client Protocol) | | O nome por extenso fica em inglês |
| AI | IA | IA (inteligência artificial) | | A sigla em português é `IA`; `AI` permanece verbatim em identificadores de código, como o escopo `@arx-ai/*` |
| API | API | | | |
| CI | CI | | | |
| CLI | CLI | CLI (interface de linha de comando) | | |
| e2e | e2e | | | |
| HMR | HMR | HMR (Hot Module Replacement) | | O nome por extenso fica em inglês, como na documentação brasileira de Vite e webpack |
| JSON Schema | JSON Schema | | | Nome da especificação; preserve as maiúsculas e o espaço |
| JSONL | JSONL | | | |
| LLM | LLM | LLM (modelo de linguagem de grande porte) | | Expansão conforme a documentação pt-BR de AWS e Google Cloud |
| MCP | MCP | | | |
| PR | PR | PR (Pull Request) | | O nome por extenso fica em inglês, como na documentação brasileira do GitHub |
| RAG | RAG | RAG (geração aumentada de recuperação) | | Expansão conforme a documentação pt-BR de AWS, Google Cloud e Microsoft |
| SDK | SDK | | | Designa apenas o protocolo JSON-RPC cliente/servidor usado pelos SDKs Python e TypeScript suportados; o projeto arx Harness em si não é um SDK |
| SSE | SSE | SSE (Server-Sent Events) | | |

## Classe inglês (os dois idiomas usam o termo em inglês)

| English | Português | Primeira ocorrência | Não traduzir como | Notas |
|---|---|---|---|---|
| agent | agent | agent (agente) | | A prosa em português mantém `agent`, inclusive no plural (`agents`); `agente` aparece só na anotação de primeira ocorrência e dentro de outras anotações |
| Agent Note | Agent Note | | nota do agente, anotação do agente | Tipo de documento definido pelo repositório, que abrange propostas, decisões implementadas e propostas rejeitadas; o H1 do lado em português mantém o prefixo fixo `# Agent Note: ` e o título não recebe anotação do termo |
| agent harness | agent harness | agent harness (framework de execução de agentes) | | Compostos com `agent` (agent harness, agent workflow, agent loop, agent skill) ficam inteiros em inglês; se `agent` ainda não tiver sido anotado, a primeira ocorrência segue a linha do composto ou a linha `agent` |
| agent loop | agent loop | agent loop (ciclo do agent) | laço do agent | |
| blob hash | blob hash | | | Resultado de `git hash-object` |
| coding agent | coding agent | coding agent (agente de programação) | | Composto com `agent`; a prosa mantém o inglês |
| Cordis | Cordis | | | |
| dispose | dispose | dispose (liberação de recursos) | descartar, destruir | |
| doc-sync | doc-sync | doc-sync (gate de sincronização da documentação) | | |
| fiber | fiber | | fibra | Unidade de execução do Cordis que é dona dos efeitos e do ciclo de vida de um plugin |
| fixture | fixture | fixture (dados de teste pré-montados) | | Mantido em inglês; é assim que a comunidade brasileira de pytest e Vitest escreve |
| fork | fork | | bifurcação, ramificação | Vale tanto para o fork de repositório quanto para o de processo |
| Function Calling | Function Calling | Function Calling (chamada de função) | | Nome próprio da funcionalidade do modelo; preserve as maiúsculas |
| harness | harness | | arreio, arcabouço | A anotação explicativa fica na linha `agent harness` |
| harness engineering | harness engineering | | | Composto com `harness`; fica em inglês |
| KV Cache | KV Cache | | | Nome técnico consagrado; preserve as maiúsculas e o espaço |
| lint | lint | | lintar | Como verbo, escreva `rodar o lint` |
| mock | mock | | | Mantido em inglês; designa o dublê de teste |
| loader | loader | | carregador | Vale também para o loader do Cordis |
| manifest | manifest | manifest (lista de metadados) | manifesto | `manifesto` em português designa um documento programático e não serve aqui |
| monorepo | monorepo | | | |
| Round | Round | | rodada, rodada de objetivo, rodada Ralph | Quando a estratégia externa usa Round, a hierarquia do domínio é Session > Round > Turn (turno) > Step (etapa); Round é uma iteração opcional da estratégia externa, não um nível presente em todo turno de sessão. Goal Round e Ralph Round também ficam em inglês. Um Round carrega um turno e as etapas pertencem a esse turno; um turno explicitamente sem etapas mantém esse sentido |
| schema | schema | | esquema | `esquema` em português também significa diagrama e fica ambíguo |
| schema DSL | schema DSL | | | |
| seam | seam | | costura, emenda, junção | O conjunto inteiro de uma capacidade substituível, com os três papéis Service Definition / Service Provider / Consumer; separe em pacotes distintos só quando os papéis evoluírem de forma independente, e um mesmo pacote pode assumir vários papéis. `packages/shell` é o exemplo de referência; o Service Definition é um `Service` do Cordis (classe abstrata ou serviço de registry concreto), não uma interface TypeScript. Nenhum papel isolado, fronteira comum ou ponto de extensão pode ser chamado de seam. A prosa deste repositório mantém o inglês; é um conceito distinto de `extension point` |
| Service Provider | Service Provider | | Service provider, provedor de serviço | Papel nomeado do seam de capacidade; o singular escreve-se sempre Service Provider e o plural, Service Providers. Um `provider` genérico que fornece um serviço não se enquadra nesta linha |
| skill | skill | skill (habilidade) | | A prosa mantém `skill`; `habilidade` aparece só na anotação de primeira ocorrência |
| slot | slot | | encaixe, vaga, ranhura | Posição nomeada e registrável na arquitetura do cliente; mantida em inglês |
| spill | spill | | vazamento, transbordo | Mecanismo que grava em disco a saída de ferramenta que excede o limite; nos compostos, escreva `arquivo de spill` e `caminho de spill` |
| spawn | spawn | | gerar, desovar | Fica em inglês inclusive como verbo: `fazer spawn de um subprocesso` |
| steering | steering | steering (direcionamento no meio da execução) | | |
| job id | job id | | id de tarefa | Mantido em inglês |
| subagent | subagent | | subagente | Composto com `agent`; a prosa mantém o inglês, inclusive no plural (`subagents`) |
| transcript | transcript | transcript (registro textual da sessão) | transcrição | O texto completo que a sessão renderiza para o usuário ou para o editor, distinto do log de eventos |
| Typert | Typert | | TypeRT, typeRT, Type RT | Grafia de produto do grafo de tipos, do gerador, do loader e do registry de runtime do arx Harness |
| waterfall | waterfall | waterfall (evento em cascata) | cascata | A prosa mantém `waterfall`; `cascata` aparece só na anotação de primeira ocorrência |
| wheel | pacote wheel | | roda | Formato de empacotamento do Python |
| worktree | worktree | | árvore de trabalho | Conceito de worktree do Git |
| Zstandard | Zstandard | | | Formato de compressão da RFC 8878; `zstd` continua sendo um valor de código |

## Classe bilíngue (cada idioma usa a forma do próprio idioma)

| English | Português | Primeira ocorrência | Não traduzir como | Notas |
|---|---|---|---|---|
| adapter | adaptador | | | Renderização consagrada na literatura brasileira de padrões de projeto |
| adapter contract | contrato do adaptador | contrato do adaptador (adapter contract) | | |
| append-only | append-only | | somente anexação, apenas acréscimo | Mantido em inglês; é assim que a engenharia brasileira descreve logs e arquivos que só recebem acréscimos |
| artifact | artefato | | artefacto, produto | `artefacto` é a forma europeia; a grafia brasileira é `artefato` |
| backend | backend | | retaguarda, camada de fundo | Mantido em inglês, como `frontend`; uso corrente no Brasil |
| binder | binder | | vinculador, ligador | Papel de nomenclatura: liga uma interface já declarada ao contexto ou ao ciclo de vida de quem chama. Mantido em inglês porque nomeia o sufixo `*Binder` no código e porque `vinculador` e `ligador` já designam o linker |
| config | configuração | | | Papel de nomenclatura: um valor de configuração já resolvido ou um registro de configuração de limites estritos. `config` permanece em inglês apenas em identificadores de código (`Config`, `cordis.yml`) |
| controller | controlador | | regente | Papel de nomenclatura: recebe uma intenção e altera um estado de domínio ou de apresentação já existente |
| directory | diretório | | catálogo, listagem | Papel de nomenclatura: expõe entradas e seus metadados para descoberta ou seleção. O mesmo termo serve para o diretório do sistema de arquivos; o contexto separa os dois |
| engine | motor | | engenho, máquina, mecanismo | Papel de nomenclatura: implementa um algoritmo de domínio ou um modelo de execução com estado. Segue o uso do MDN pt-BR (`motor de renderização`) |
| gateway | gateway | | portal, porta de entrada | Papel de nomenclatura: adapta uma fronteira de processo, rede, RPC ou API. Mantido em inglês, como em `gateway de pagamento` e `API gateway` |
| handle | handle | | alça, punho, identificador | Papel de nomenclatura: referencia um recurso vivo para controlá-lo ou observá-lo. Mantido em inglês e masculino (`o handle`); `identificador` fica reservado para `id` |
| policy | política | | diretiva, regra, apólice | Papel de nomenclatura: decide o que é permitido, escolhido, limitado ou observado. `política` é a renderização consagrada em segurança e permissões no Brasil; `regra` fica reservado para `rule` |
| presenter | presenter | | apresentador, exibidor | Papel de nomenclatura: converte de forma pura um valor de domínio em intenção de renderização. Mantido em inglês, como o `Presenter` do padrão MVP na literatura brasileira; `apresentador` designa quem apresenta um programa |
| resolver | resolver | | resolvedor, solucionador | Papel de nomenclatura: calcula ou localiza uma resposta a partir da entrada. Mantido em inglês, como na documentação brasileira de GraphQL e DNS; escreva sempre com artigo (`o resolver`) para não confundir com o verbo homógrafo |
| store | store | | loja, armazenamento, repositório | Papel de nomenclatura: é dono de um conjunto de dados e oferece principalmente operações sobre eles. Mantido em inglês, como na documentação brasileira de Redux, Vuex e Pinia; `repositório` designa o repositório Git e `armazenamento`, o storage |
| background job | tarefa em segundo plano | | tarefa de fundo | `job id` continua em inglês, conforme a linha própria |
| block | bloco | | | |
| build target | alvo de build | | alvo de compilação | `build` fica em inglês na prosa em português: `o build`, `rodar o build` |
| cancel | cancelar | | abortar | O substantivo é `cancelamento`; `abortar` fica reservado para `abort` |
| canary test | teste canary | | teste canário | Este repositório mantém `canary` em inglês |
| capability | capacidade | | funcionalidade, recurso | Deve ficar distinta de `feature` → `funcionalidade`; `recurso` fica reservado para `resource` |
| capability seam | seam de capacidade | | seam de funcionalidade, costura de capacidade | Conceito de arquitetura nomeado deste repositório: os três papéis Service Definition, Service Provider e Consumer formam juntos uma capacidade substituível completa; um `seam` comum continua seguindo a linha dele |
| feature | funcionalidade | | capacidade, recurso | Unidade de produto gerenciável no modelo de produto e de engenharia do SDK; `recurso` fica reservado para `resource` |
| feature option | opção de funcionalidade | | variante | Implementação ou configuração finita e selecionável dentro de uma funcionalidade do SDK |
| checkpoint | checkpoint | | ponto de verificação, ponto de controle | Mantido em inglês: é um estado salvo para retomar, não uma verificação, e é o termo que times brasileiros usam em banco de dados e em execução de agents |
| chunk | chunk | | pedaço, fragmento | Mantido em inglês; uso corrente no Brasil em streaming, empacotamento e RAG. `bloco` fica reservado para `block` |
| compaction | compactação | compactação (compaction) | compressão | Redução do histórico ou do contexto; `compressão` fica reservado para `compression` (Zstandard e afins) |
| companion tool | ferramenta complementar | | ferramenta acompanhante | |
| composition bundle | bundle de composição | | pacote de composição | Vale apenas no contexto de composição de aplicação ou de plugins; não rege todo uso de `bundle`. `bundle` fica em inglês e `pacote` fica reservado para `package` |
| Cordis plugin config | configuração de plugin do Cordis | | | Objeto `Config` ou estrutura de configuração que um plugin do Cordis expõe |
| config key | chave de configuração | | | Um campo isolado da configuração de um plugin do Cordis |
| consumer | consumidor | | usuário, cliente | Quem consome o serviço no código; distinto de `user` (`usuário`). O papel nomeado `Consumer` do seam permanece em inglês e com maiúscula |
| content block | bloco de conteúdo | | | |
| Cookbook | manual prático | manual prático (cookbook) | livro de receitas | Termo de título de documento |
| context | contexto | | | O tipo `Context` do Cordis e a variável `ctx` permanecem como código |
| counterpart | counterpart | | parâmetro, contrapartida, equivalente | Contexto de pareamento bilíngue: o arquivo do outro idioma. Mantido em inglês conforme translation-rules.md, que fixa `atualizar o counterpart`; para o sentido genérico de "o outro lado", escreva `o outro lado` |
| configurable-provider directory | diretório de provedores configuráveis | | | Diretório mantido por `registerConfigurableProviders()` no seam de llm; segue o precedente de Service Catalog → `catálogo de serviços` |
| context compaction | compactação de contexto | compactação de contexto (context compaction) | | |
| contract | contrato | | acordo, convenção, combinado | Pré-condições, pós-condições, invariantes e promessas de compatibilidade que quem chama, implementa, provê ou consome pode exigir, nunca um combinado informal. Exemplo: `pairing contract` → `contrato de pareamento` |
| Cordis config entry | entrada de configuração do Cordis | | | Designa um item da lista de plugins em `cordis.yml`; a implementação do plugin em si escreve-se `plugin do Cordis` |
| Cordis plugin | plugin do Cordis | | | Implementação de plugin que o Cordis carrega, não um item de configuração de `cordis.yml` |
| crash recovery | recuperação após falha | | recuperação de acidente, recuperação de desastres | Retomada depois que o processo cai de forma abrupta; `recuperação de desastres` é `disaster recovery` e não se aplica aqui |
| deploy root | raiz do deploy | | raiz de implantação | `deploy` fica em inglês na prosa em português |
| dormant | dormente | | adormecido, inativo | Designa um provedor já declarado como configurável, mas ainda sem rota registrada; `inativo` fica reservado para `inactive` |
| durability | durabilidade | | | Propriedade dos dados que sobrevivem a uma queda |
| feature requirement | dependência de funcionalidade | | requisito de funcionalidade | Relação que uma funcionalidade ou opção de funcionalidade declara por `requires` |
| event | evento | | | |
| event log | log de eventos | | registro de eventos | `log` fica em inglês; `registro` fica reservado para `record` |
| event stream | stream de eventos | | fluxo de eventos | Segue a linha `stream` |
| event-sourced | baseado em event sourcing | | orientado a eventos, baseado em origem de eventos | O estado é reconstruído a partir do log de eventos. A comunidade brasileira de DDD mantém `event sourcing` em inglês, e `orientado a eventos` designa outro conceito (event-driven) |
| Executive summary | Resumo executivo | | Sumário executivo | Termo de título em postmortem; `sumário` em pt-BR é índice |
| executor | executor | | | |
| expected output | saída esperada | | gabarito, padrão ouro | Designa o artefato de comparação de snapshot; as amostras de calibração humana do corpus de tradução não entram nesta linha |
| extension | extensão | | plugin | `plugin` fica em inglês e é outro conceito |
| extension point | ponto de extensão | | | Atenção à distinção em relação a `seam` |
| fail-fast | fail-fast | | falha rápida | Mantido em inglês; é como a prática é nomeada na engenharia brasileira |
| fenced code block | bloco de código cercado | | bloco de código isolado | Bloco delimitado por cercas de crases ou tis; o delimitador em si aparece como `code fence` na prosa deste repositório, e a anotação depois dele é a `info string` |
| fingerprint | fingerprint | | impressão digital, digital | Impressão de conteúdo genérica; mantida em inglês, como no uso brasileiro em segurança. O mecanismo de pareamento bilíngue usa o registro sidecar para guardar o blob hash dos dois lados |
| finish reason | motivo de término | | razão final | O nome de campo `finish_reason` permanece verbatim em código |
| fold | seção recolhível | | dobra, prega | Contexto de interface de configuração: seção de campos recolhida por padrão (`collapsed` → `recolhido`) |
| foreground run | execução em primeiro plano | | | |
| freshness | atualidade | | frescor | Forma par com `fresh` (`atualizado`) e `stale` (`desatualizado`); neste projeto designa o estado de sincronia da tradução ou do arquivo gerado em relação à fonte |
| hook | hook | | gancho | Mantido em inglês, como no uso brasileiro corrente (hooks do Git, hooks de React) |
| implementation | implementação | | | |
| inference | inferência | inferência (inference) | raciocínio | A execução do modelo que produz a resposta; distinta de `reasoning` → `raciocínio`. Mantenha a anotação em inglês apenas quando o texto contrastar os dois |
| info string | info string | | string de informação | Termo do CommonMark, mantido em inglês como já ocorre em translation-rules.pt-BR.md; designa a anotação de linguagem escrita logo depois da cerca de abertura |
| injection | injeção | | | Por exemplo, `injeção de dependência` |
| integration | integração | | | |
| interface | interface | | | Feminino: `a interface` |
| language switcher | seletor de idioma | | switcher de idioma, alternador de idioma | Termo do mecanismo de pareamento i18n: a linha de links recíprocos logo abaixo do H1 dos arquivos pareados |
| merge | merge | | fusão, mesclagem | Mantido em inglês, inclusive nos compostos (`merge driver`, `merge-forward`); como verbo, `fazer merge` |
| message | mensagem | | | |
| mod | mod | | modificação, módulo | Mantido em inglês; distinto de `module` → `módulo` |
| model provider | provedor de modelos | | fornecedor de modelos | |
| model selection | seleção de modelo | | alvo de modelo, destino de modelo | Escolha de provedor, de modelo e da intensidade opcional de raciocínio, voltada ao agent |
| module | módulo | | | |
| non-escalation | não escalonamento de privilégios | | não atualização, não promoção | Só vale em contextos de segurança e de permissão: o sujeito não pode obter permissões além das que já detém; um `upgrade` comum não usa esta linha |
| npm dependency | dependência npm | | dependência NPM | Relação entre pacotes declarada em `package.json`; campos como `dependencies` e `devDependencies` permanecem verbatim, e `npm` mantém a grafia minúscula canônica |
| opt-out ratio | proporção de opt-out | | proporção de saída, taxa de desistência | `opt-out` fica em inglês; uso consagrado em pt-BR |
| orphan | órfão | | abandonado, solto | Designa um `.pt-BR.md` cuja fonte em inglês não existe mais (`tradução órfã`); em contexto de processos, segue o uso de sistema operacional (`processo órfão`) |
| orphan branch | branch órfão | | ramo órfão | `branch` fica em inglês e é masculino (`o branch`), como na documentação pt-BR do GitHub |
| package | pacote | | | Designa um pacote npm (`@arx-ai/arx-*`); identificadores de código como `package.json` permanecem verbatim |
| pairing | pareamento | | emparelhamento, casamento | |
| parent-subset grants | concessões de subconjunto do pai | | concessões do conjunto pai | O escopo concedido fica restrito a um subconjunto do que o pai já detém; `autorização` fica reservado para `authorization` |
| peer dependency | peer dependency | | dependência de par, dependência par | Mantida em inglês, junto ao campo `peerDependencies` do `package.json`; é assim que a comunidade brasileira de npm e pnpm escreve |
| permission | permissão | | autorização | `autorização` fica reservado para `authorization` |
| persistence | persistência | | | |
| pipeline | pipeline | | esteira, linha de montagem | Mantido em inglês; uso corrente no Brasil em CI/CD e em processamento de dados |
| plugin | plugin | | plug-in, complemento, extensão | Mantido em inglês; `extensão` fica reservado para `extension` |
| postmortem | postmortem | | autópsia, análise pós-morte, relato de incidente | Documento que registra e analisa um incidente; mantido em inglês, como nos times brasileiros de SRE, e em diretórios ou caminhos permanece como código |
| prompt | prompt | | instrução, comando | Mantido em inglês; uso corrente no Brasil, e `comando` fica reservado para `command` |
| provider | provedor | | fornecedor | O papel nomeado do seam permanece `Service Provider` em inglês |
| provider-neutral | independente de provedor | | neutro em relação ao provedor, agnóstico a provedor | |
| quality gate | gate de qualidade | | portão de qualidade, barreira de qualidade | `gate` fica em inglês e é feminino em português (`a gate`), como já ocorre em translation-rules.pt-BR.md; o repositório chama de gate toda verificação bloqueante |
| quiescence | parada completa | | quiescência, silêncio, ociosidade | Estado alcançado depois que todo o trabalho de ciclo de vida se encerrou; o `dispose` precisa alcançá-la, não apenas pedi-la, e `ocioso` fica reservado para `idle` |
| reasoning | raciocínio | raciocínio (reasoning) | inferência | O texto de deliberação do modelo; distinto de `inference` → `inferência`. Mantenha a anotação em inglês apenas quando o texto contrastar os dois |
| reasoning_content | conteúdo de raciocínio | | conteúdo de pensamento | O nome de campo `reasoning_content` permanece verbatim em código |
| registry | registry | | registro, cadastro | Mantido em inglês e masculino (`o registry`); `registro` fica reservado para `record` |
| replay | replay | | reprodução, repetição | Mantido em inglês; uso consagrado em pt-BR para replay de eventos e de snapshot. Como verbo, `fazer replay de` |
| resume | retomar | | resumir, sumarizar | `resumir` é falso cognato e significa `summarize`. O substantivo é `retomada`; distinto de `crash recovery` → `recuperação após falha` |
| runtime | runtime | | tempo de execução | Como substantivo, fica em inglês (`o runtime do Node`); a locução `at runtime` traduz-se `em tempo de execução` |
| same-world subprocess | subprocesso que compartilha o sistema de arquivos e o kernel com o host | | subprocesso do mesmo mundo | Descreva a relação; não calque `same-world` |
| sandbox | sandbox | | caixa de areia | Mantido em inglês e masculino (`o sandbox`); uso corrente no Brasil |
| service | serviço | | | Os papéis nomeados `Service Definition`, `Service Provider` e `Consumer` permanecem em inglês |
| serving interface | interface exposta pelo serviço | | interface de atendimento, interface de serviço | Os métodos que um serviço oferece a quem o consome; não confundir com o papel `Service Definition` |
| session | sessão | | | |
| session event | evento de sessão | | | |
| setup card | cartão de configuração | | cartão de instalação | Cartão de configuração que, na primeira execução, aparece já expandido no lugar do cartão de linha |
| sidecar file | arquivo sidecar | | arquivo acompanhante, arquivo lateral | Arquivo comum que acompanha o documento no mesmo diretório; `sidecar` fica em inglês, como na documentação brasileira de Kubernetes |
| sidecar record | registro sidecar | | registro anexo, registro pendurado | Arquivo de registro que acompanha o documento no mesmo diretório |
| smoke test | teste de fumaça | | teste de fumo | Termo do glossário BSTQB/ISTQB em pt-BR |
| snapshot | snapshot | | instantâneo, captura | Mantido em inglês, como na documentação pt-BR da AWS e na prática brasileira de testes |
| source of truth | fonte da verdade | | fonte de informação, fonte única | Escreva `fonte única da verdade` apenas quando a fonte disser `single source of truth` |
| spine | espinha dorsal | | coluna, tronco | Identificadores como `arx-agent-spine-demo` permanecem em inglês |
| stale | desatualizado | | expirado, obsoleto | Forma par com `fresh` (`atualizado`); na saída das gates, o literal `stale` permanece em inglês. `expired` é que se traduz `expirado`, e `obsoleto` fica reservado para `deprecated` |
| step | etapa | | | Nível da hierarquia Session > Round > Turn > Step; segue o uso pt-BR do GitHub e da Microsoft |
| stream | stream | | fluxo | Mantido em inglês (`o stream`, `streaming`); uso corrente no Brasil, e `fluxo` fica reservado para `flow` |
| structural signature | assinatura estrutural | | | Termo do mecanismo de pareamento i18n: a sequência estrutural ordenada que a gate extrai ao comparar os dois lados (níveis de cabeçalho, blocos de código, listas e afins) |
| Summary | Resumo | | Sumário | Termo de título em postmortem; `sumário` em pt-BR é índice |
| system prompt | prompt de sistema | | prompt do sistema operacional | |
| taxonomy | taxonomia | | | |
| token usage | uso de tokens | | consumo de fichas | `token` fica em inglês; uso corrente no Brasil |
| tool | ferramenta | | | Distinto de `toolkit` → `kit de ferramentas` |
| tool call | chamada de ferramenta | | | |
| tool result | resultado da ferramenta | | | |
| tool schema | schema da ferramenta | | esquema da ferramenta | Segue a linha `schema` |
| toolkit | kit de ferramentas | | caixa de ferramentas | |
| turn | turno | | rodada, vez | Nível da hierarquia Session > Round > Turn > Step; `rodada` fica proibido porque disputaria com `Round` |
| VFS | VFS | sistema de arquivos virtual (VFS) | sistema de ficheiros virtual | `arquivos`, nunca `ficheiros`, que é a forma europeia |
| typecheck | verificação de tipos | | checagem de tipos | O comando `pnpm run typecheck` permanece como código |
| vocabulary | vocabulário | | | |
| wire format | formato de transmissão | formato de transmissão (wire format) | formato de fio, formato de cabo | O formato dos bytes trocados na conexão |
| workflow | workflow | | fluxo de trabalho | Mantido em inglês: nomeia uma capacidade, um pacote e uma ferramenta deste repositório, os compostos com `agent` já ficam inteiros em inglês, e é a forma usada por desenvolvedores brasileiros |
| wrapper | wrapper | | invólucro, empacotador | Camada de software ou camada de SDK que embrulha outra; mantido em inglês e masculino (`o wrapper`) |
| wrapper script | script wrapper | | script invólucro | Camada executável de script |
