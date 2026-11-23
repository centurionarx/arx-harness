# Agent Note: gates de CI paralelas no GitHub

Status: implemented
Archived: 2026-07-26

[English](2026-07-06-parallel-github-ci-gates.md) | Português

## Problema

As gates de CI do GitHub que rodam sem chave são, em sua maioria, ortogonais: verificação de tipos, lint, atualidade da documentação, cobertura, replay de snapshot, build, higiene de publicação de pacotes, teste de fumaça da demo e teste de fumaça dos binários construídos falham por motivos diferentes e não precisam do estado de runtime umas das outras. Rodá-las como uma única cadeia ordenada de comandos faz o tempo de relógio do workflow ser igual à soma dessas gates, enquanto dividir cada folha curta em um job próprio do GitHub repete checkout, configuração do Node, restauração do pnpm e instalação até que a sobrecarga de orquestração se torne o gargalo.

A divisão original em faixas amplas deixou de atender a esse equilíbrio conforme o workspace cresceu. No merge do PR #404, os jobs de estática, cobertura, snapshot e artefatos no Linux levaram 148, 195, 94 e 230 segundos; a estática e os artefatos no Windows levaram 251 e 482 segundos. O empacotamento pelo gerenciador de pacotes, feito uma vez por pacote, dominava os dois validadores de artefatos, a cobertura reconstruía sem necessidade a saída antes de uma suíte que só usa o código-fonte, e as gates pesadas em CPU disputavam recursos dentro das faixas de estática e de cobertura.

A fronteira de artefatos continua sustentando o desenho. `publint`, `verify-node-next-types`, o carregamento das invariantes compiladas e os testes de fumaça dos binários construídos precisam da saída `lib/` emitida. A divisão em shards não pode colocar esses consumidores em corrida à frente do build nem substituir o sinal de artefato publicado deles pela execução a partir do código-fonte.

## Decisão

A topologia de produção abaixo é histórica e foi substituída por [Evidence-based larger hosted runners](2026-07-22-evidence-based-larger-hosted-runners.md). A decisão dos runners maiores remove os seletores de shard e os jobs de workflow dela; esta nota preserva por que aquela topologia anterior foi implementada.

O [CI](../../../../.github/workflows/ci.yml) trata um minuto para os jobs fora do Windows e três minutos para os jobs do Windows como metas de desempenho observadas, não como prazos de cancelamento. A variância dos runners hospedados deve deixar evidência completa de tempo e logs de falha úteis, em vez de cancelar uma gate que de resto está correta. A [referência de CI serial multiplataforma](2026-07-21-serial-cross-platform-ci-reference.md) roda de forma independente o agregado primário completo do Node, sem shards, no Linux, no macOS e no Windows, para que o inventário otimizado de faixas não seja o próprio oráculo de completude.

Nessa topologia, [scripts/run-gates.ts](../../../../scripts/run-gates.ts) era o escalonador limitado comum, e o GitHub fornecia nomes de shard explícitos para as famílias de gates caras. `scripts/static-shards.ts` particionava as gates estáticas pela posse de fundação, tipos da documentação, contrato de API, catálogo, prosa, projeção da documentação e build da documentação, e rejeitava uma atribuição de gate ausente ou duplicada. O lint no Linux usava faixas disjuntas A-C, D-M, N-S e T-Z de código-fonte de pacotes e de testes de pacotes, enquanto o Windows usava faixas completas de código-fonte de pacotes e de testes de pacotes; ambos incluíam um complemento do repositório a partir de `.`, para que novos alvos de nível superior não pudessem desaparecer entre shards, e eram donos da única execução de duplicação entre arquivos. `scripts/coverage-shards.ts` atribuía cada pacote do workspace a exatamente uma faixa de cobertura de código-fonte. Os filtros de diretório mantinham um separador final porque os filtros posicionais do Vitest casam substrings e, sem ele, admitiriam irmãos com o mesmo prefixo no nome. Cada faixa de cobertura incluía apenas os arquivos de código-fonte que lhe pertenciam, repetia o teste exaustivo de topologia de companions e rodava sem um build anterior, porque a suíte completa de cobertura passa a partir de uma árvore com todo `lib/` gerado removido.

O replay de snapshot usava duas faixas explícitas de vários arquivos e oito partições de cenários do grande arquivo de ACP (Agent Client Protocol). `scripts/snapshot-shards.ts` era dono desse inventário, e o teste dele descobria todo arquivo admitido pela configuração de snapshot. Cada job de snapshot instalava as dependências enquanto o seu runner Linux preparava o Bubblewrap, construía o runtime distribuído e rodava apenas a superfície de replay que lhe fora atribuída. A suíte mantinha a concorrência limitada a cinco subprocessos porque o replay passava a maior parte do tempo esperando a E/S de protocolo dos filhos. As proteções de fixtures ainda inspecionavam a tabela completa de cenários de ACP em cada partição.

A verificação de tipos da documentação, isolada e a frio, reconstrói o grafo completo de referências de projeto, então uma faixa dedicada de tipos da documentação faz o build uma vez e verifica os blocos de Markdown contra essas declarações. A faixa de documentação do Linux usa o build MPA do VitePress para manter a renderização das páginas e a validação de links quebrados dentro da meta observada para fora do Windows; faixas separadas e bloqueantes no Windows, uma de build e outra do site de produção, preservam as verificações de pacote emitido e de site distribuído sem colocar os dois caminhos críticos em um só job.

Os artefatos usam duas faixas: uma de metadados, para `publint`, declarações NodeNext e carregamento das invariantes compiladas, e uma de teste de fumaça dos binários construídos. Cada faixa produz o próprio build antes dos seus consumidores. Repetir o build curto custa minutos de runner, mas evita uma dependência de upload/download e mantém limitado o caminho crítico de cada job.

[scripts/publint-all.ts](../../../../scripts/publint-all.ts) chama a API suportada do publint dentro do processo, contra uma visão de publicação em memória montada a partir dos arquivos declarados em cada manifest e dos arquivos de metadados obrigatórios do npm. Isso preserva a distinção entre arquivos do workspace e arquivos publicados sem fazer spawn de um comando de pack do gerenciador de pacotes 103 vezes. [scripts/verify-built-package-invariants.mjs](../../../../scripts/verify-built-package-invariants.mjs) dispõe esses arquivos de `lib/` declarados no manifest, já validados estruturalmente, abaixo do pacote real, e então importa a autorreferência compilada por meio do Node puro e da normalização do Loader do Cordis. Um companion que alcança um chunk de runtime não declarado continua falhando.

As faixas de compatibilidade rodam os testes de fumaça do worker de código-fonte e do runtime de Zstandard em toda linha de Node anunciada. O TypeScript verifica o grafo de código-fonte uma vez, em uma faixa dedicada do Node 24 primário; repetir a mesma análise do compilador nos jobs de compatibilidade de runtime acrescentava tempo sem sinal específico de runtime.

O workflow guarda em cache o store do pnpm, vincula cada cache imutável do ESLint à chave do shard de lint que é dono dele, preserva o PowerShell nativo para as medições no Windows e mantém um único status agregado `all checks passed` para a proteção de branch. O Windows reutiliza as três partições exaustivas de lint e agrupa as gates de fundação/catálogo/prosa e as de tipos da documentação/contrato de API atrás de configurações de runner compartilhadas; só o escalonamento difere das partições do Linux. O build e a validação do site de produção no Windows continuam bloqueantes, enquanto a matriz mais ampla de estática, lint e artefatos no Windows continua observacional.

## Alternativas consideradas

- **Manter as faixas amplas** - minimiza o YAML do workflow, mas preserva o ciclo de feedback de vários minutos que foi medido.
- **Rodar cada gate folha como um job separado do GitHub** - maximiza a distribuição em paralelo, mas geradores curtos e verificações de prosa gastariam mais tempo preparando um runner do que verificando o repositório.
- **Fazer upload de um único build para os consumidores de artefatos** - evita a compilação repetida, mas o upload/download e o escalonamento de dependências alongam o tempo de relógio; o build limpo é curto o bastante para ser repetido dentro de faixas limitadas.
- **Manter o empacotamento pelo gerenciador de pacotes nas duas gates de publicação** - delega a seleção do inventário ao pnpm, mas repete mais de 200 processos do gerenciador de pacotes. A gate estrutural de manifest somada às fixtures de visão de publicação torna explícito o contrato do inventário otimizado e falha diante de uma dependência presente em disco, mas não publicada.
- **Manter o build antes da cobertura** - fornece uma saída emitida que a suíte de código-fonte não consome mais; uma prova de cobertura em árvore limpa mostrou que era pura latência.
- **Verificar tipos em toda versão do Node** - repete o trabalho do compilador, enquanto os testes de fumaça de compatibilidade já exercitam o comportamento real de carregamento e de compressão específico de cada Node.

## Consequências

Os inventários de shards e os jobs de matriz descritos acima não fazem parte do contrato atual do repositório. A decisão dos runners maiores, que substitui esta, mantém o inventário primário completo em um só processo e usa a suíte serial como seu oráculo de completude independente.

Os validadores de publicação otimizados dependem do contrato de `files` do manifest, imposto por `verify-package-invariants`. Se as regras de publicação crescerem além desse contrato, a gate estrutural e as duas visões dispostas precisam mudar juntas.

Os jobs de compatibilidade não afirmam mais que o próprio TypeScript foi exercitado sob todo runtime do Node. Eles comprovam o carregamento de código-fonte sensível ao runtime no Node 22, 24 e 26, enquanto o runtime primário é dono da única verificação de tipos do grafo de código-fonte.
