# Agent Note: O rascunho do intent ecoa no mesmo tick

Status: implemented
Archived: 2026-07-26

[English](2026-07-26-intent-draft-same-tick-echo.md) | Português

## Problema

O composer principal ("Let's start building") é uma textarea controlada cujo valor é o prompt retido do Session Intent do frontend, lido do snapshot da **lista** de sessões (`EmptyState` vincula `intent.prompt` via `useSessions`). A digitação passava por `SessionManager.updateIntent → Session.updatePendingPrompt`, que faz o flush do notifier **da própria Session** de forma síncrona. Só que o snapshot da lista, do qual o composer realmente renderiza, só ficava sabendo da mudança pela assinatura de watch do intent em `startIntent`, que chama `markDirty()`, um flush adiado para uma microtask.

Um eco adiado viola o contrato de input controlado documentado no Notifier (veja a [nota de arquitetura do cliente web](../architecture/2026-07-19-gui-web-client-architecture.md)): o React compara o valor do DOM com o snapshot ainda desatualizado durante o mesmo tick do `onChange` e reverte a textarea. Na digitação simples isso aparece como saltos do caret; com um IME, corrompe a entrada: toda atualização de composição é revertida e reaplicada sobre um valor desatualizado, então digitar o Pinyin "nihao" confirma fragmentos como "nnini hni hani hao" seguidos da palavra chinesa composta. O composer residente (`ConversationRoot`) não foi afetado: o rascunho dele vive no store do chat (flush síncrono) ou vem de `updateSessionPrompt`, que lê o snapshot da Session diretamente, e não a projeção da lista.

## Decisão

`SessionManager.updateIntent` chama `this.notifier.notifyNow()` depois de `updatePendingPrompt`, fazendo o flush do snapshot da lista no mesmo tick do evento de mudança. Isso segue a regra de canal do Notifier: o eco direto de um gesto do usuário cujo input controlado renderiza a partir desse snapshot usa `notifyNow`; o watch do intent mantém `markDirty` para todas as outras transições (assíncronas) do intent.

## Alternativas consideradas

**Trocar o callback do watch do intent em `startIntent` para `notifyNow`.** É o canal errado para esse seam: o watch também dispara em mudanças da Session guiadas por frame (publicação, fases de envio), e a nota de arquitetura proíbe `notifyNow` para fontes guiadas por frame porque ele desfaz o batching.

**Fazer `EmptyState` ler o prompt do snapshot da Session em vez da lista.** Reestrutura o contrato do slot (EmptyState é deliberadamente vinculado ao feed padrão de `useSessions` e ainda não tem escopo de sessão, pois a Session do frontend é local à página) sem ganho algum em relação a fazer o flush da projeção que ele já lê.

**Suprimir a reversão em `InputBar` com estado local não controlado.** Esconde o sintoma, abre mão do rascunho como fonte única da verdade (o prompt retido precisa sobreviver à troca de workspace de destino e ao envio/nova tentativa) e deixa exposto todo outro input controlado pelo snapshot da lista.

## Consequências

A digitação no composer principal, inclusive a composição por IME, ecoa de forma síncrona. `updateIntent` em um estado sem intent continua sendo um no-op sem notificação. O helper de composer do snapshot de workspace-flow da web agora verifica o eco no mesmo tick em vez de esperar por ele, então uma regressão para um eco adiado faz a gate de snapshot sem chave falhar; um teste unitário de runtime fixa o mesmo contrato no seam do manager.
