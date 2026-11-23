# Agent Note: Projeção de status de PR para Issue que só avança

Status: implemented
Archived: 2026-08-10

[English](2026-08-04-forward-only-pr-issue-status.md) | Português

## Problema

O status da Issue no Project representa a fase do trabalho, enquanto uma palavra-chave de resolução exata e do mesmo repositório estabelece a relação oficial entre o PR (Pull Request) e a Issue. Restringir o avanço do ciclo de vida às Issues que já estão em `Ready` deixa uma Issue em `Inbox` ou `Backlog` depois de a implementação ter comprovadamente começado. Exigir metadados de PR válidos nos demais aspectos antes de projetar a fase também confunde a conformidade com a política com o estado observável do trabalho.

## Decisão

Os eventos de PR e de revisão de PR projetam a fase atual do PR em toda Issue de resolução exata do mesmo repositório. Um PR em rascunho, ou um PR que não está em rascunho e não tem pedido de revisão nem revisão enviada, tem como alvo `In progress`. Um PR que não está em rascunho e tem qualquer uma das duas formas de atividade de revisão tem como alvo `In review`.

Os status ativos têm a ordem `Inbox`, `Backlog`, `Ready`, `In progress` e `In review`. A projeção só escreve quando o alvo vem depois nessa ordem. Ela não move uma Issue para trás, não altera `Done` nem `No action` e não adiciona uma Issue que não tem status no Project. O caminho do ciclo de vida é independente da validação de metadados do PR; a verificação obrigatória e separada da política de PR continua impondo a consistência de labels, referências e prioridade.

Essa projeção é intencionalmente de mão única. Ela não consulta, a partir de uma Issue, os PRs relacionados e não acrescenta um reconciliador agendado. Os eventos de PR são a fonte do avanço do ciclo de vida. A decisão pura de transição é exercitada pelo teste de gerenciamento de Issues, e esse teste roda nas gates `check-all`, `ci-primary` e `ci-static`.

## Verificação

`.github/issue-management/policy.test.mjs` cobre o avanço a partir de todo status ativo anterior, as distinções de rascunho e de revisão, a independência em relação à política de metadados e a proteção contra transições para trás ou a partir de status terminais. `scripts/run-gates.ts` é dono da execução desse teste de política focado nos modos de gate de nível superior, local e de CI.

## Alternativas consideradas

**Exigir `Ready` como único status de origem.** Isso preserva um pré-requisito manual, mas deixa itens desatualizados em `Inbox` e `Backlog` mesmo quando o PR de resolução prova que a implementação começou.

**Acrescentar reconciliação bidirecional ou agendada.** Buscar PRs a partir de eventos de Issue ou varrer o Project poderia consertar mais históricos, mas acrescenta outra direção de autoridade e trabalho recorrente de API além do ciclo de vida guiado por PR que é exigido.

**Condicionar a projeção a metadados de PR completos.** Labels, referências e prioridade continuam precisando de imposição, mas um defeito de metadados não torna falsa a fase de implementação ou de revisão.

**Mover os status para trás quando um PR volta a ser rascunho ou perde revisores.** Isso faria um estado transitório do PR sobrescrever uma fase de trabalho observada depois e complicaria a propriedade do status. Por isso a projeção permanece monotônica.

## Consequências

- Um evento de PR corrige por si só uma Issue de resolução deixada em `Inbox`, `Backlog` ou `Ready`.
- Uma Issue criada depois do último evento de PR relevante espera por um evento de PR posterior ou por uma atualização manual de status, porque não há busca reversa nem varredura agendada.
- Um PR em rascunho permanece `In progress` mesmo que tenha atividade de revisão histórica; só um PR que não está em rascunho tem como alvo `In review`.
- Os status terminais e os status ativos posteriores continuam protegidos contra regressão.
- As falhas de metadados de PR continuam visíveis pela verificação obrigatória de política, sem suprimir a projeção do ciclo de vida.
