# Agent Note: Renderização rica de bash no ACP — o cartão de terminal pela convenção `_meta`

Status: implemented
Archived: 2026-07-26

[English](2026-06-18-acp-terminal-and-tool-rendering.md) | Português

> Substituída, no caso do ACP (Agent Client Protocol), por [ACP as an automation-only protocol](../simplification/2026-07-23-acp-automation-only-protocol.md). As intenções de renderização das ferramentas continuam disponíveis para os transportes de UI, mas o ACP não as projeta mais em cartões de terminal.

## Problema

A ponte ACP deixa cada ferramenta ser dona da renderização de sua chamada por meio de `presentCall`/`presentResult` (veja [tool-call UI presentation](2026-06-14-acp-agent-client-protocol.md) e `packages/core/tools`). Para `bash`, expomos o comando exato como título do `tool_call`, a `description` do modelo como um bloco de conteúdo de texto, `kind: 'execute'` e a saída concluída embrulhada em um bloco de texto cercado ` ```console `.

Os editores de referência renderizam os metadados de terminal como um cartão dedicado com cwd, comando, saída em estilo ao vivo e status de saída; o texto puro perde essa estrutura. O comando é o título porque os cartões de execução ocultam a entrada bruta, enquanto a descrição legível por humanos permanece como um bloco separado acima do cartão.

## Achado principal: terminais executados pelo agent usam uma convenção `_meta`, NÃO `terminal/create`

A especificação do ACP tem um subprotocolo de terminal *do lado do cliente*: o agent (agente) chama o `terminal/create` do cliente com `{ command, args, cwd, env }` e o **editor** executa o processo; depois o agent lê `terminal/output` / `wait_for_exit`. Esse modelo é errado para nós: nosso harness executa o bash por conta própria por meio do `dsh-bash` (limpeza de ambiente em sandbox, posse das tarefas em segundo plano, cwd por sessão). Rotear a execução para o editor contornaria tudo isso e dividiria a execução em dois backends.

O estudo dos dois agents de referência (2026-06-18) mostra que nenhum deles usa `terminal/create` para sua própria ferramenta de shell: **ambos mantêm a execução do lado do agent e emitem uma convenção `_meta`** que o Zed trata como caso especial:

- **`claude-agent-acp`** (`tools.ts`, `acp-agent.ts`): condicionado a `clientCapabilities._meta.terminal_output`. O `tool_call` carrega `content: [{ type: 'terminal', terminalId }]` e `_meta.terminal_info.{ terminal_id, cwd }`; a saída e o encerramento chegam em `_meta.terminal_output.{ terminal_id, data }` e `_meta.terminal_exit.{ terminal_id, exit_code, signal }` do `tool_call_update`.
- **`codex-acp`** (`CodexToolCallMapper.ts`, `TerminalOutputMode.ts`): o mesmo `terminal_info` na chamada; a saída vem por `_meta.terminal_output` (completa) ou `_meta.terminal_output_delta` (incremental), selecionada a partir da mesma capacidade `_meta.terminal_output`.

O lado do Zed (`crates/agent_servers/src/acp.rs`, verificado): em um `ToolCall` cujo `_meta.terminal_info.terminal_id` está definido, ele registra um terminal **somente de exibição** (cabeçalho = `terminal_info.cwd`, rótulo = `tool_call.title`); em um `ToolCallUpdate`, `_meta.terminal_output.data` escreve nesse terminal e `_meta.terminal_exit.{exit_code,signal}` define o status. Ele anuncia a capacidade como `clientCapabilities._meta.terminal_output = true`. O `_meta` em si é um ponto de extensibilidade do ACP abençoado pela especificação (tipado como `{[k]: unknown} | null` em `ToolCall`/`ToolCallUpdate`); as *chaves específicas* daqui (`terminal_info`/`terminal_output`/`terminal_exit`) são uma convenção do Zed, não parte da especificação do ACP, mas são o contrato de fato da integração com o Zed e a única maneira de obter o cartão de terminal mantendo a execução do lado do agent.

## Decisão

Manter a execução do `dsh-bash` do lado do agent; renderizar o cartão de terminal pela convenção `_meta`, condicionada à capacidade, com o bloco de texto ` ```console ` como fallback garantido.

1. **Capacidade.** O `initialize` lê `clientCapabilities._meta.terminal_output`, e a ponte guarda esse valor por conexão.
2. **Vocabulário de apresentação neutro.** O `dsh-tools` ganha uma apresentação em formato de terminal que uma ferramenta pode retornar: independente de provedor (`cwd`, os `data` de saída, um `exitCode`/`signal`), SEM tipos do ACP. O `dsh-tool-bash` a retorna para `bash` (cwd vindo do diretório de trabalho resolvido; saída + encerramento extraídos do resultado da execução).
3. **Mapeamento da ponte.** Quando o cliente anunciou a capacidade, a ponte mapeia essa apresentação para: no `tool_call`, `content:[…, {type:'terminal', terminalId}]` (qualquer `content` da ferramenta, por exemplo a descrição, renderizado ANTES do bloco de terminal) + `_meta.terminal_info.{terminal_id,cwd}`; no `tool_call_update`, `_meta.terminal_output.{terminal_id,data}` (a saída capturada) + `_meta.terminal_exit.{terminal_id, exit_code|signal}` (o encerramento extraído), com o `content` de texto da atualização OMITIDO (um `tool_call_update.content` do ACP SUBSTITUI a coleção de conteúdo da chamada, então reenviar o bloco cercado destruiria o bloco de conteúdo de terminal). O `terminalId` é derivado do `callId` do harness (estável, único por chamada). Quando a capacidade está ausente, a ponte envia o bloco de conteúdo com a descrição na chamada e o conteúdo de texto ` ```console ` já existente na atualização, sem mudanças.
4. **O indicador de saída é extraído da saída renderizada; nenhum caminho novo de execução, nenhum streaming ao vivo.** A saída é anexada na conclusão (a partir do `tool/result` do próprio agent), não transmitida token a token. O indicador de status de saída (`_meta.terminal_exit.{exit_code,signal}`) É emitido: o seam puro `presentResult(args, result)` enxerga apenas blocos de conteúdo, então o `dsh-tool-bash` recupera o encerramento estruturado fazendo o parse dos marcadores de status (`[exit code: N]` / `[killed by signal: …]`) que o `renderResult` acrescentou; o parse é o inverso exato da emissão dos marcadores, os dois evoluem juntos em um só arquivo, e um teste de ida e volta protege o par. O dispose (liberação de recursos) não é afetado: não há nada novo a desmontar, já que a ponte nunca cria um terminal do lado do cliente.

## Alternativas consideradas

- **O subprotocolo de terminal do lado do cliente do ACP (`terminal/create`)**: explicitamente rejeitado. O editor executaria o processo, contornando a limpeza de ambiente, a posse das tarefas em segundo plano e o cwd por sessão do `dsh-bash`, e dividindo a execução em dois backends. Os dois agents de referência o rejeitam do mesmo modo (o achado principal acima); a execução do lado do agent somada à convenção `_meta` é o único desenho que entrega o cartão de terminal mantendo a política de execução do harness.
- **Passar um encerramento estruturado pelo schema de eventos**: rejeitado em favor da ida e volta pelos marcadores. O seam puro `presentResult(args, result)` enxerga apenas blocos de conteúdo, e o parse é o inverso exato da emissão dos marcadores, evoluindo junto em um só arquivo sob um teste de ida e volta.

## Consequências

- **Chaves `_meta` da convenção do Zed.** O cartão de terminal se apoia em chaves específicas do Zed (`terminal_info`/`terminal_output`/`terminal_exit`) dentro do ponto de extensibilidade `_meta` do ACP, abençoado pela especificação, NÃO no subprotocolo de terminal do ACP. Um cliente que não reconhece as chaves ainda recebe o fallback de texto (a condição de capacidade garante que só as emitimos quando o cliente aderiu via `_meta.terminal_output`), então um cliente que não é o Zed nunca fica em situação pior. Se o ACP vier a padronizar terminais executados pelo agent, migre para esse padrão e abandone as chaves da convenção.
- **Honestidade de capacidade.** Emita metadados de terminal APENAS quando o cliente anunciou `_meta.terminal_output`; o fallback de texto é o contrato para todos os demais e nunca pode regredir. Coberto por um teste sem capacidade que verifica o caminho ` ```console `.
- **Colisões de terminalId.** Derivá-lo do `callId` de cada chamada o mantém único dentro de uma sessão e estável ao longo do par chamada/resultado; nunca reutilize um entre chamadas.
- **Encerramento extraído do texto renderizado.** O indicador de saída recupera `exit_code`/`signal` fazendo o parse dos marcadores de status do `renderResult`, em vez de passar um encerramento estruturado pelo schema de eventos (que o seam puro `presentResult` nunca enxerga). O parse é o inverso exato da emissão dos marcadores e vive no mesmo arquivo; um teste de ida e volta fixa o par, de modo que uma mudança no formato dos marcadores que quebre o parse faz a suíte falhar. Se os marcadores precisarem divergir do que o indicador quer, exponha um encerramento estruturado no evento de resultado.
- **Inchaço do vocabulário independente de provedor.** A apresentação de terminal amplia a superfície do `dsh-tools`; mantenha-a neutra (nenhum tipo do ACP vaza para o `dsh-tools`) e apenas tão rica quanto um segundo consumidor de UI também desejaria.

## Fora de escopo / não objetivos

A base em bloco de texto continua sendo o padrão sem capacidade. Duas continuações deliberadamente NÃO são construídas aqui, e cada uma mereceria sua própria Agent Note quando alguém as assumir: **streaming incremental ao vivo** (`_meta.terminal_output_delta` à medida que os chunks chegam, o que exige um seam de saída incremental no `dsh-bash`) e **classificação de comandos** (interpretar um `cat`/`sed` como um cartão `read` com a localização do arquivo, um `grep` como um `search` etc., recorrendo ao cartão de terminal; somente de exibição, nunca pode alterar o que é executado).
