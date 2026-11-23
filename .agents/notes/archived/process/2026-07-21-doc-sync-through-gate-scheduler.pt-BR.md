# Agent Note: doc-sync pelo escalonador de gates

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-doc-sync-through-gate-scheduler.md) | Português

## Problema

O `pnpm run doc-sync` era uma cadeia `&&` de 24 subcomandos `pnpm run`. Cada elo pagava uma inicialização completa do wrapper do pnpm (resolução do workspace, busca do script, inicialização do tsx) antes de o script dele rodar; medidos em um host de desenvolvimento, os 24 corpos de script juntos terminam em cerca de 34 segundos, enquanto a forma encadeada leva em torno de 3 minutos, e a demora do wrapper se reproduz em disco local, de modo que todo desenvolvedor e toda trilha de CI pagam esse custo, não apenas os checkouts em sistema de arquivos de rede. A cadeia também rodava em série, embora as gates que a compõem sejam somente leitura e independentes, e divergiu silenciosamente de [scripts/run-gates.ts](../../../../scripts/run-gates.ts): `verify-cordis-api` entrou na cadeia quando o catálogo da API de runtime chegou, mas nunca foi adicionada a `docSyncLeafGates`, de modo que o CI nunca impôs a atualidade desse catálogo.

## Decisão

O `doc-sync` em `package.json` delega ao escalonador limitado já existente, `tsx scripts/run-gates.ts doc-sync`, como os scripts `check:ci:*` ([escalonamento paralelo de gates](2026-07-06-parallel-pre-push-gates.md), [topologia atual do CI](2026-07-22-evidence-based-larger-hosted-runners.md)). O modo `doc-sync` se expande exatamente para `docSyncLeafGates()`, o que faz da lista de folhas em `run-gates.ts` a fonte única da verdade para o conjunto de membros. O modo local limita a concorrência padrão a quatro workers porque várias gates de documentação constroem, cada uma, um `ts.Program` completo; `DSH_GATE_CONCURRENCY` continua sobrepondo esse limite.

`docSyncLeafGates` inclui `verify-cordis-api`, de modo que as verificações locais de documentação relevantes e o CI submetem o catálogo gerado da API de runtime à gate junto com os outros documentos gerados.

## Alternativas consideradas

- **Manter a cadeia `&&` e corrigir apenas a folha ausente**: repara a divergência de hoje, mas mantém duas listas de membros que voltarão a divergir e mantém as 24 inicializações em série do wrapper do pnpm.
- **Um `scripts/doc-sync.ts` dedicado que importa cada módulo de verificação em um único processo**: economiza até a inicialização do tsx por gate, mas exige refatorar todos os 24 scripts de execução na importação para pontos de entrada chamáveis e perde a medição de tempo, o isolamento e o agrupamento de falhas por gate do escalonador; a inicialização do wrapper, que o escalonador já evita, é o custo dominante.
- **Loop de shell sobre `tsx scripts/*.ts`**: evita as inicializações do wrapper do pnpm a baixo custo, mas acrescenta um segundo vocabulário de execução ao lado do escalonador que o CI já usa, sem nada do escalonamento nem dos relatórios dele.

## Consequências

Um `pnpm run doc-sync` agora custa uma inicialização do wrapper do pnpm mais a cadeia de dependências mais lenta entre as gates membros, em vez de 24 inicializações do wrapper mais a soma de todos os membros. Adicionar uma gate de documentação é uma edição em `docSyncLeafGates` (mais o próprio script do pacote, para execuções avulsas); o `package.json` mantém os scripts `verify-*` por gate como o vocabulário para rodar uma gate à mão. O escalonador imprime o tempo de cada gate, de modo que um doc-sync lento aponta para a gate que domina. A saída de `pnpm run doc-sync` agora é a saída intercalada do escalonador, em vez da saída sequencial por comando; qualquer coisa que faça parsing dessa saída precisa se basear nas linhas de resumo `run-gates:`.
