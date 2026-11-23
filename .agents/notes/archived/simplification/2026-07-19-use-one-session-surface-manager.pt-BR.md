# Agent Note: Usar um único surface manager por sessão

Status: implemented
Archived: 2026-07-26

[English](2026-07-19-use-one-session-surface-manager.md) | Português

## Problema

`Session` mantinha duas instâncias de `SurfaceManager` sobre o mesmo log de eventos append-only. Uma validava os candidatos de seed e de append, enquanto uma segunda instância lazy processava de forma independente os eventos commitados para `session.surface`, as mensagens derivadas, a compactação (compaction) e o contexto de workspace. Depois que a surface pública era lida, todo evento posterior avançava o estado duplicado de nós e de geração de substituição sem criar uma autoridade separada nem uma fronteira de falha.

## Decisão

Cada `Session` é dona de um `SurfaceManager` construído de forma eager. A aceitação de seed e de append chama `validateNext()` nesse manager antes de commitar um evento, e `session.surface` retorna o mesmo objeto por meio deste contrato readonly:

```ts
export interface SessionSurface {
  readonly nodes: readonly number[]
  readonly replaceGeneration: number
}
```

A validação de candidatos continua atômica. `validateNext()` pode sincronizar as entradas commitadas do log, mas apenas planeja o candidato não commitado. O candidato entra no estado do manager depois de `log.push()` e da próxima sincronização de delta, então as falhas de validação da surface e os vetos de `internal/dispatch` anteriores ao commit não deixam nenhum nó fantasma nem geração de substituição.

`foldSurface()` continua sendo a função desanexada de replay do log completo para validação e reconstrução offline. Ela usa as mesmas transições e concorda com o manager vivo em todo prefixo commitado, sem compartilhar estado mutável.

## Alternativas consideradas

**Manter separados o estado de aceitação e o de projeção.** Instâncias separadas pareciam isolar as leituras públicas da validação, mas quem chama já recebe o estado da surface por empréstimo, e o contrato readonly declarado impede a mutação comum. Duplicar o manager não era uma fronteira de confiança em tempo de execução.

**Recalcular a surface pública a partir do log completo a cada acesso.** Isso removia o estado duplicado em cache, mas abria mão da derivação incremental e fazia a construção repetida de requests escalar com o histórico completo da sessão.

## Consequências

- A aceitação, `session.surface`, as mensagens derivadas, a compactação e o contexto de workspace observam um único estado incremental.
- `Session.surface` não expõe nenhum método de validação, enquanto a identidade do objeto e o array readonly de nós emprestado permanecem estáveis.
- Um cast hostil ainda pode corromper o estado emprestado; quem chama a partir de JavaScript e contorna deliberadamente o contrato readonly continua fora da fronteira suportada dentro do mesmo processo.
- Os testes de surface, seed, veto de dispatch, reconstrução de request, compactação e contexto de workspace exercitam o manager compartilhado e os caminhos de replay desanexado.
