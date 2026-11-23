# Agent Note: capacidade de pergunta ao usuário (ask-user)

Status: implemented
Archived: 2026-07-27

[English](2026-06-25-ask-user-question.md) | Português

## Problema

Às vezes o agent (agente) não consegue prosseguir com segurança apenas com a inferência do modelo: ele precisa que o humano escolha um caminho, confirme uma ação arriscada ou padrão, ou forneça uma informação que falta. Antes desta mudança, a única forma de obter essa resposta era o modelo perguntar em texto de assistente e então parar, o que quebrava o ciclo normal de chamadas de ferramenta: o agent não tinha uma forma estruturada de pausar, nem metadados de opções para as UIs, nem taxonomia de cancelamento e de erro, nem um jeito de as portas de entrada que não usam stdio apresentarem a pergunta de forma consistente.

Esta é uma capacidade voltada ao usuário, mas ela também atravessa fronteiras de pacote. Uma ferramenta voltada ao modelo precisa de um vocabulário de requisição independente de provedor; cada superfície de UI precisa decidir como mostrar a pergunta e coletar a resposta; o agent loop (ciclo do agent) deve permanecer inalterado porque uma chamada de ferramenta já tem a forma assíncrona certa.

## Decisão

Introduzir `dsh-user-interaction` como o pacote de interface independente de provedor para `ctx.userInteraction`, colocado junto do consumidor voltado ao modelo `dsh-tool-ask-user` em `packages/ui`. O agrupamento é intencional: perguntar a um humano é um recurso de produto apoiado em UI, não parte da espinha dorsal do core, que não tem provedores. O seam continua sendo dono do vocabulário estável de requisição, resposta e erro, enquanto as superfícies de produto de UI fornecem o provedor concreto que coleta a resposta. A ferramenta registra `ask_user_question`, encaminha `{ questions, agent, signal }` e retorna as respostas estruturadas calculadas pelo provedor como resultado da ferramenta.

O vocabulário de requisição voltado ao modelo é deliberadamente alinhado ao schema da pesquisa de produto: `ask_user_question({ questions: [{ id, question, header?, options?: [{ label, description? }], multi_select? }] })`. O `id` é fornecido por pergunta e ecoado no resultado, de modo que um lote possa ser roteado sem depender do texto da pergunta. O `label` é ao mesmo tempo o texto de exibição voltado ao usuário e o valor selecionado devolvido ao modelo; não existe `value` separado, nem `recommended`, nem `allow_custom`, nem alias `desc`.

Os provedores retornam `{ answers: [{ id, selected, custom? }] }`. `selected` é sempre um array dos rótulos de opção selecionados, de modo que as respostas de seleção única e de `multi_select` compartilham uma só forma de resultado. `custom` carrega uma resposta "Other" em texto livre; perguntas sem opções coletam `custom` diretamente. Quando `custom` está presente, ele prevalece sobre quaisquer escolhas selecionadas e `selected` fica vazio. Um provedor que suporta conclusão parcial representa um item pulado deliberadamente com a forma já existente `{ id, selected: [] }`, preservando as outras respostas sem ampliar o vocabulário do resultado da ferramenta.

`UserInteractionError` estende `HarnessError`, de modo que falhas como `NO_PROVIDER`, `ASK_ABORTED` ou a ausência de posse da requisição sobrevivem a `ctx.tools.execute()` como erros de ferramenta `{ name, code }` roteáveis por máquina. Isso corresponde à taxonomia de erros estruturados e permite que o modelo ou um plugin wrapper distinga "user cancelled" de uma exceção genérica lançada.

## Mapeamentos de UI

O `dsh web` monta `dsh-client-ui-question`, cuja metade de host habilita no produto Web a ferramenta voltada ao modelo e cuja metade de navegador registra uma entrada `question` no slot de composer com chave que pertence à conversa. O `createApiProxy` implementa o provedor Web com uma tabela de pendências em memória de processo, indexada por um rpcId emitido pelo host. Ele registra a espera antes de transmitir `question/requested`, faz replay do mesmo id a cada reabertura do mux, valida a sessão e o lote completo de respostas antes de reivindicá-lo e transmite `question/resolved` depois de resposta, cancelamento, abort ou dispose (liberação de recursos). Reivindicar apaga a entrada de forma síncrona, de modo que a primeira resposta válida vence e respostas duplicadas ou tardias retornam `not-pending`.

O composer da Web mostra uma pergunta por vez e retém todas as requisições na camada de objetos da sessão. Ele suporta seleção única, seleção múltipla, respostas personalizadas explícitas ou sem opções, texto de descrição e um selo visual de recomendação, sem selecionar a recomendação automaticamente. Escolhas de seleção única avançam imediatamente para o próximo item, e Enter envia quando todos os itens estão respondidos ou explicitamente pulados; Enter durante a composição de IME apenas confirma o candidato de entrada. O rodapé pula somente o item atual e preserva os rascunhos anteriores; o controle de fechar rejeita a chamada de ferramenta inteira com `ASK_CANCELLED`. O composer normal só volta depois que o quadro de resolução do host remove o item pendente.

O `dsh-tui` renderiza cada pergunta como uma sobreposição de teclado, mostra as descrições das opções, suporta escolhas de seleção única e múltipla, além de respostas personalizadas em formato livre, e rejeita as perguntas pendentes em caso de abort, dispose do provedor ou encerramento do terminal. Requisições em lote e simultâneas entram em fila, de modo que uma única sobreposição seja dona do foco do teclado por vez.

Existia um mapeamento de elicitação do ACP (Agent Client Protocol) enquanto a ponte era uma UI de editor; [ACP como protocolo apenas de automação](../simplification/2026-07-23-acp-automation-only-protocol.md) removeu esse terceiro mapeamento.

## Alternativas consideradas

**Texto de assistente seguido de um turno interrompido.** O modelo poderia perguntar ao usuário em texto simples de assistente e então parar. Isso perde os metadados estruturados de opções, não dá às UIs uma forma independente de provedor de renderizar uma escolha e força a próxima resposta humana a chegar como um novo prompt de usuário, em vez de como resultado da operação que precisava da resposta.

**Pacotes de ask-user pertencentes ao core.** A primeira implementação dividia o seam e a ferramenta voltada ao modelo entre `packages/core` e `packages/ui`, mas os dois nomes descrevem um único recurso de interação humana apoiado em UI. O seam continua independente de provedor, mas não é infraestrutura de core sem provedores, como as sessões, as ferramentas ou o registry de agents. Manter `dsh-user-interaction` e `dsh-tool-ask-user` juntos em `packages/ui` faz o mapa de pacotes corresponder à fronteira do produto: aplicativos e pontes fornecem o provedor da resposta humana, e o aplicativo stdio habilita a ferramenta voltada ao modelo.

**Usar uma requisição de permissão para perguntas gerais.** Requisições de permissão autorizam a execução de ferramentas; `ask_user_question` coleta informação com respostas opcionais em formato livre. Reutilizar o canal de permissão fundiria dois conceitos de produto diferentes.

**Uma primitiva de pausa no nível do loop.** O agent loop já sabe aguardar uma chamada de ferramenta e retomar a partir de um resultado da ferramenta. Adicionar um novo caso especial ao loop duplicaria essa forma assíncrona e obrigaria toda implementação de loop a conhecer uma preocupação de UI.

## Consequências

A funcionalidade dá ao modelo uma primitiva de pausa poderosa, então a orientação no prompt importa. A descrição da ferramenta instrui o modelo a fazer perguntas concisas e a usar opções quando possível. A política de produto pode mais tarde envolver `tools/execute` para restringir quando a ferramenta é permitida, mas o loop não deve tratá-la como caso especial.

`dsh-user-interaction` e `dsh-tool-ask-user` ficam ambos em `packages/ui` porque formam uma única capacidade de interação humana voltada ao produto. O `agent-core` não carrega nem a ferramenta nem um provedor. O `dsh-tui-demo` habilita o seam, o provedor da TUI e a ferramenta voltada ao modelo. O `dsh web` inicializa o seam e o provedor no runtime do host e expõe a ferramenta por meio do plugin de pergunta da Web selecionado. O aplicativo de automação ACP não monta nem o seam nem a ferramenta.

## Testes

A cobertura unitária fixa o registro e o dispose de provedor, a rejeição de provedor duplicado, o abort antes do provedor, a rejeição de pergunta vazia, os erros de ferramenta estruturados por `ctx.tools.execute()`, as respostas em lote, as respostas de seleção múltipla, as respostas personalizadas, os itens pulados explicitamente um a um e o schema do modelo, incluindo a remoção de `value`, `recommended`, `allow_custom` e `desc`. Os testes da TUI cobrem descrições de opções, requisições em fila, limpeza em encerramento e abort, entrada em formato livre sem opções, escolhas inválidas, seleções duplicadas em seleção múltipla e fluxos de perguntas em lote. Os testes da Web fixam o replay com id estável, a validação da resposta, a liquidação em que a primeira resposta vence, as respostas duplicadas e tardias, o cancelamento da requisição inteira em contraste com o abort pelo dono, o avanço em seleção única, o envio por Enter seguro para IME, a preservação dos itens pulados um a um, a tomada do composer, o envio estruturado em lote e a restauração do composer normal.
