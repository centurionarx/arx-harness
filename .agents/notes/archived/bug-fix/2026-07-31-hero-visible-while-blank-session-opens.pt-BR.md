# Agent Note: O hero permanece visível enquanto uma sessão em branco abre

Status: implemented
Archived: 2026-08-07

[English](2026-07-31-hero-visible-while-blank-session-opens.md) | Português

## Problema

A raiz da conversa tem uma fase `settling` para uma sessão que ainda está abrindo enquanto seu composer lê `blank`: não há como saber se o resultado será hero ou barra ancorada até o histórico chegar, então o lugar do composer fica oculto (`visibility:hidden`) em vez de piscar o hero centralizado e saltar para a barra ancorada. A seleção automática na inicialização transformou essa proteção no defeito que ela deveria evitar. A partir do hero sem workspace, `WorkspacesService.startInitialSelection` conecta o workspace mais recente e abre a sessão em branco dele; `openState` muda para `loading` no momento em que `open()` chega, então a coluna central ficava em branco durante toda a ida e volta do histórico e depois era repintada, o que se lê como uma atualização da página inteira a cada inicialização.

## Decisão

`ConversationRoot` lê a flag `blank` do resumo da lista de sessões junto com o snapshot da conversa e isenta do settling as sessões que o resumo comprova estarem em branco: `settling` exige adicionalmente `summaryBlank !== true`, e `hero` aceita um composer em branco sempre que o resumo comprova que a sessão está em branco, em todo estado de abertura e não só em `loading`. Uma sessão que a lista já informa como em branco só pode terminar no hero, então ocultar não traz ganho e custa o piscar visível; a mesma prova vale antes de a abertura começar (`cold`) e depois de uma falhar (`error`), casos em que as condições anteriores caíam na fase ativa e renderizavam um composer nu ancorado sob o chrome que `ConversationSession` oculta para sessões em branco. Sempre que o resumo não comprova que a sessão está em branco (uma linha que informa `blank: false`, ou nenhuma linha porque a lista ainda não se atualizou), `summaryBlank` não é `true` e a ocultação conservadora do settling não muda.

A flag do resumo e o `blank` do próprio snapshot são fontes distintas: o snapshot descreve a sessão que está sendo aberta, o resumo é a linha da lista que já existe antes de a abertura se resolver. Só a segunda está disponível cedo o bastante para decidir a fase.

## Alternativas consideradas

**Remover a fase settling por completo.** Rejeitada porque ela ainda se justifica para uma sessão sem linha de resumo: sem uma afirmação prévia sobre o vazio, não há mesmo como saber se o resultado será hero ou barra ancorada, e o piscar que ela evita é o pior dos dois.

**Adiar a mudança para `loading` até o histórico retornar.** Rejeitada porque `openState` é a autoridade sobre a operação de abertura; adiá-lo para suprimir um artefato de apresentação informaria errado o estado dos dados a todos os outros consumidores.

**Fazer cross-fade ou animar de outra forma a ocultação do settling.** Rejeitada porque a coluna não tem nada a mostrar durante a ida e volta de qualquer maneira: a correção é não ocultar conteúdo cujo resultado já é conhecido, e não decorar a ocultação.

## Adiado

A rotatividade de referências na camada de objetos encontrada durante este diagnóstico (projeções sem efeito que criam snapshots novos, o caminho de criação que projeta duas vezes, `select()` que usa `notifyNow` a partir de continuações assíncronas) é real, mas independe do piscar visível.

## Consequências

A seleção automática na inicialização renderiza o hero imediatamente e mantém o lugar do composer e o cabeçalho visíveis durante a ida e volta do histórico, então iniciar em um workspace recente deixa de parecer um recarregamento de página. As sessões cujo resumo não comprova que estão em branco mantêm o comportamento anterior de settling, então a proteção ainda cobre o caso para o qual foi escrita. Testes de esqueleto fixam as três formas de resumo: uma linha que informa `blank: false` entra em settling, uma linha ausente entra em settling, e uma sessão comprovadamente em branco pelo resumo, abrindo sob `loading`, renderiza o chrome do hero com uma textarea ativa.

A cobertura da aplicação montada é `apps/web/tests/startup-auto-selection.e2e.ts` (trilha de navegador web sem chave). Sua primeira conexão de Workspace verifica que a raiz do Hero, o chip de Workspace, o corpo de rolagem, o lugar do composer e a textarea continuam sendo os mesmos nós do DOM quando a Session em branco aparece. Em seguida, ele segura aberta a resposta de `session.history` na fronteira de rede do navegador e verifica o quadro visível enquanto a abertura selecionada automaticamente está em andamento (fase hero, título do hero, composer pintado), além de uma linha do tempo de fases registrada de exatamente `['hero']` durante todo o carregamento. Segurar a ida e volta é o que faz do segundo caso um teste de regressão e não uma corrida: contra um host de loopback, a abertura se resolve rápido demais para ser amostrada, e, com a isenção revertida, a janela segurada é precisamente quando a raiz informa `settling`.
