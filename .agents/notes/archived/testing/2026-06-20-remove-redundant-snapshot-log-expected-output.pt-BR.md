# Agent Note: Usar `session.jsonl` como o único artefato de log de sessão dos snapshots

Status: implemented
Archived: 2026-07-26

[English](2026-06-20-remove-redundant-snapshot-log-expected-output.md) | Português

## Problema

Os cenários de snapshot do ACP (Agent Client Protocol) que acionam o modelo trazem tanto `session.jsonl` quanto `session.expected.jsonl`. Nos cenários gravados normais, `session.jsonl` é o fixture (dados de teste pré-montados) de replay colhido de uma execução real, e o teste de replay normaliza o log recém-persistido e o compara com `session.expected.jsonl`. Nos fixtures atuais, os dois logs normalizados são idênticos nos cenários gravados comuns.

Os cenários de override escritos à mão (`error-finish`, `cancel`) hoje usam `replay.override.json` para conduzir o comportamento do modelo e mantêm `session.jsonl` como um fixture fictício mínimo, enquanto `session.expected.jsonl` guarda o log persistido esperado. O arquivo de override é um array JSON de objetos `ReplayEntry`: `{ "kind": "chunks", "chunks": StreamChunk[] }`, `{ "kind": "throw", "chunks": StreamChunk[], "message": string, "code": string }` ou `{ "kind": "hang" }`. Essa divisão também é desnecessária: quando existe um sidecar de override, `llm-replay` substitui o roteiro derivado e não precisa de `session.jsonl` para os chunks do modelo, então `session.jsonl` ainda pode ser o artefato de log de sessão esperado do cenário.

## Decisão

O conceito de `session.expected.jsonl` é removido por inteiro. Todo cenário tem no máximo um artefato de log de sessão versionado, `session.jsonl`:

- Nos cenários gravados, `session.jsonl` continua sendo o log bruto colhido. O replay ainda deriva dele os chunks do modelo, e o teste de snapshot compara o log persistido e normalizado da execução de replay com o `session.jsonl` normalizado.
- Nos cenários de override escritos à mão, `replay.override.json` conduz o comportamento do modelo e `session.jsonl` guarda o log de sessão esperado como resultado. O adaptador de replay ignora o fixture para os chunks do modelo quando o override existe, então o mesmo arquivo pode ser o log esperado sem afetar o comportamento do replay.
- Nos cenários sem modelo, `session.jsonl` pode continuar como o fixture mínimo necessário para inicializar `llm-replay`; nenhuma comparação de log de sessão é necessária, a menos que o cenário crie uma sessão persistida.

As saídas esperadas de stdout permanecem inalteradas; elas são a projeção voltada ao editor e não são redundantes com o fixture de sessão.

## Alternativas consideradas

**Normalizar os dois lados contra um contexto compartilhado (o da execução de replay)** — rejeitado: `normalizeSessionLog` limpa o cwd por correspondência exata de string, então o cwd gravado no fixture sobreviveria sem limpeza e toda comparação falharia. Cada lado é normalizado contra o seu próprio contexto derivado do header — a nota de implementação abaixo traz a mecânica.

## Verificação

`session.expected.jsonl` não aparece em lugar algum do harness de snapshot, dos fixtures, das guardas contra órfãos ou dos docs; o teste de snapshot deriva o log de sessão esperado de `session.jsonl` em todo cenário com modelo; os cenários de sidecar escritos à mão versionam o log esperado como resultado em `session.jsonl`, com `replay.override.json` como o override do comportamento do modelo; e as guardas contra fixtures órfãos sabem quais arquivos cada tipo de cenário exige. A [Agent Note dos testes de snapshot do ACP](2026-06-19-acp-snapshot-tests.md) descreve o conjunto reduzido de fixtures.

## Consequências

Quem revisa perde um nome de artefato que deixava o log persistido esperado visualmente separado do fixture de replay. A saída esperada de stdout ainda protege o transcript do editor, e comparar a saída do replay com `session.jsonl` preserva a verificação de regressão do loop e da persistência sem duplicar arquivos.

## Nota de implementação

Cada lado é normalizado contra os valores do seu próprio header porque a gravação e o replay têm ids, caminhos e timestamps diferentes. `fixtureContext()` deriva o contexto do fixture a partir do header dele, o que torna idempotentes os fixtures já normalizados. Os logs de sessão usam igualdade simples em vez de atualizações de snapshot de arquivo, então a comparação nunca reescreve fixtures.
