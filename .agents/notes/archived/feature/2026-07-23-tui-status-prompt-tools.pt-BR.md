# Agent Note: O status da TUI inspeciona as entradas da requisição ao modelo

Status: implemented
Archived: 2026-08-04

[English](2026-07-23-tui-status-prompt-tools.md) | Português

## Problema

Os contadores de sessão descrevem a atividade, mas não revelam as instruções e as capacidades que a próxima requisição ao modelo recebe. Sem isso, diagnosticar contribuições de prompt com escopo e restrições de ferramentas exige sair da TUI ou inferir a configuração a partir de arquivos.

## Decisão

`/status` monta o prompt de sistema do agent (agente) atual por meio de `ctx.systemPrompt` e o renderiza com o mesmo renderizador usado pelo agent loop. Depois do cartão de diagnósticos com borda, as seções separadas e sem borda `System prompt` e `Registered tools` mostram o prompt renderizado e os nomes de ferramentas na ordem da montagem, que são os schemas expostos ao modelo para aquele agent e aquele modo de apresentação.

A montagem usa o sinal de cancelamento do comando e o escopo do agent atual, de modo que seções com escopo, variáveis, restrições de ferramentas e listeners de montagem coincidem com uma requisição feita naquele ponto. Os valores de prompt e de ferramentas passam pelo sanitizador de controles de terminal da TUI, que os escapa antes da renderização. Um texto de prompt vazio e uma lista de ferramentas vazia aparecem como `(empty)` e `(none)`.

## Alternativas consideradas

**Ler as seções do prompt e o registry de ferramentas de forma independente.** Rejeitada: isso contorna os waterfalls (eventos em cascata) de montagem do prompt, a ordenação das ferramentas, os modos de apresentação e as restrições por agent, de modo que os diagnósticos poderiam divergir da próxima requisição.

**Mostrar os schemas completos das ferramentas.** Rejeitada: os nomes respondem quais capacidades estão registradas sem deixar o cartão de status dominado por JSON de parâmetros; os detalhes dos schemas continuam disponíveis no catálogo de ferramentas gerado e nas definições do código-fonte.

## Consequências

O comando pode executar provedores de prompt e listeners de montagem, exatamente como a preparação de uma requisição, e relata as falhas deles pelo aviso de erro de comando já existente. O snapshot vale para aquele instante: um registro, uma restrição, uma mudança de modo ou um provedor dinâmico posteriores podem alterar a próxima requisição.

## Testes

Os testes de comportamento do pacote fixam a saída da montagem com escopo, os nomes de ferramentas ordenados, os rótulos de vazio e o escape de controles de terminal. Os snapshots semânticos do pacote exercitam `/status` em larguras normal e estreita; uma implantação que distribui a TUI é dona da aceitação do seu processo montado.
