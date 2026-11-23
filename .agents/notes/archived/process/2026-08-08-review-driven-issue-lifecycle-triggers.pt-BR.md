# Agent Note: gatilhos do ciclo de vida de Issues acionados por revisão

Status: implemented
Archived: 2026-08-10

[English](2026-08-08-review-driven-issue-lifecycle-triggers.md) | Português

## Problema

O workflow de ciclo de vida de Issues lê o pull request atual depois de cada evento de repositório assinado e projeta as Issues que ele resolve adiante, para `In progress` ou `In review`. Um rascunho que resolve uma Issue já chega a `In progress` a partir do seu evento `opened`. Mudar esse rascunho para pronto não cria nenhum resultado novo de ciclo de vida até que um revisor seja solicitado ou envie uma revisão; ainda assim, assinar `ready_for_review` dispara mais um job hospedado e cria mais um token do GitHub App.

A automação de rascunho para pronto costuma enviar uma revisão instantes depois. Nessa sequência, o job de pronto não consegue avançar a Issue, enquanto o job de revisão continua necessário para observar a fase `In review`.

## Decisão

O [ciclo de vida de Issues](../../../../.github/workflows/issue-lifecycle.yml) não assina `pull_request.ready_for_review`. Ele mantém `pull_request.review_requested` e `pull_request_review.submitted`, de modo que tanto um revisor solicitado quanto uma revisão enviada podem avançar para `In review` uma Issue em resolução. O handler continua buscando o pull request vivo, em vez de derivar a fase do payload que o disparou.

A [política de Issues](../../../../.github/workflows/issue-policy.yml) continua assinando `ready_for_review`. Esse workflow é dono da verificação obrigatória quando um pull request humano entra em revisão; remover um gatilho do ciclo de vida não enfraquece a aplicação da política.

O teste de workflow analisa os dois arquivos e fixa essa divisão. Os testes da política de ciclo de vida fixam, em separado, que pull requests em rascunho e abertos que resolvem uma Issue chegam a `In progress`, enquanto uma solicitação de revisão ou uma revisão enviada chega a `In review`.

## Alternativas consideradas

- **Manter os dois eventos e cancelar uma execução em andamento** - rejeitada porque a concorrência pode descartar uma execução pendente, mas não consegue combinar dois payloads de webhook em uma só execução. Cancelar a mutação anterior também faz a correção depender da ordem de chegada, enquanto um job de pronto já concluído ainda consome a configuração completa do runner.
- **Remover o evento de revisão enviada** - rejeitada porque uma revisão pode chegar sem uma solicitação explícita de revisão. Nesse caminho, `pull_request_review.submitted` é o único evento de repositório que expõe a transição para `In review`.
- **Atrasar todo evento de pull request atrás de um despachante com debounce** - rejeitada porque mais uma fila ou um workflow agendado acrescenta latência e estado de plano de controle para eliminar um gatilho que não carrega nenhuma informação de ciclo de vida.

## Consequências

Um rascunho que fica pronto não dispara mais trabalho do ciclo de vida de Issues. A Issue em resolução permanece em `In progress`, a partir de um evento anterior de pull request, até que uma revisão seja solicitada ou enviada; nesse ponto, uma única execução acionada por revisão pode avançá-la para `In review`. A verificação obrigatória da política de Issues continua rodando na fronteira de pronto.

Se uma fase futura do ciclo de vida depender do próprio status de pronto, essa mudança precisa restaurar o gatilho e atualizar o teste de workflow e esta decisão. Até lá, omitir `ready_for_review` economiza uma execução hospedada na sequência comum de pronto seguido de revisão, sem perder nenhuma transição de status.
