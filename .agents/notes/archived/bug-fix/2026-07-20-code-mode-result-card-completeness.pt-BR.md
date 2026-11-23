# Agent Note: Manter completo o cartão de resultado do Code Mode

Status: implemented
Archived: 2026-07-26

[English](2026-07-20-code-mode-result-card-completeness.md) | Português

## Problema

A ferramenta externa `run_code` persistia o conteúdo renderizado completo, mas o presenter de UI dela ignorava esse conteúdo e reconstruía o corpo do cartão a partir de uma projeção `presentationMeta` que continha apenas logs. Uma execução só com resultado parecia correta porque um corpo vazio do presenter deixava os consumidores recorrerem a `tool/result.content`. Assim que o programa emitia um log, o presenter fornecia conteúdo não vazio, esse fallback cessava e o valor retornado desaparecia do cartão concluído. A prévia final de início e fim (head/tail) de uma política de spill ficava vulnerável à mesma divisão de propriedade sempre que os logs capturados tornavam não vazia a projeção desatualizada.

As chamadas Code aninhadas nunca foram donas de cartões, de modo que produzir metadados para a chamada externa apenas para reconstruir um único cartão incompleto também obscurecia a fronteira pretendida de um cartão só.

## Decisão

O pipeline canônico do registry de ferramentas é dono do conteúdo externo final voltado ao modelo. Em caso de sucesso, o renderizador de saída de `run_code` renderiza os logs capturados seguidos do valor de retorno ou do marcador explícito de ausência de saída. O `ToolRegistry` normaliza as falhas de runtime e as negações de política anteriores à execução em conteúdo de erro, sem invocar esse renderizador. Um bloqueio pós-execução roda depois da renderização bem-sucedida e substitui o resultado por conteúdo de erro; outras decisões pós-execução de política e de spill podem substituir o conteúdo antes da persistência.

`run_code` omite `presentResult`. O fallback genérico de resultado já estabelecido mantém o título do programa pendente e renderiza o `tool/result.content` final bruto; essa projeção durável, passível de replay e posterior às políticas é a única fonte de conteúdo de resultado do cartão. O proxy da API do host, portanto, omite uma view de resultado separada em vez de serializar o mesmo conteúdo tanto em `event.data.content` quanto em `view.view.content`. A projeção redundante `presentationMeta`, que continha apenas logs, continua removida.

O dispatch aninhado permanece inalterado. As chamadas marcadas por `exec.parent` emitem eventos `tool/code-dispatch` (conteúdo renderizado completo), mas nenhum cartão de superfície `tool/call` ou `tool/result`, de modo que uma invocação externa de `run_code` continua produzindo exatamente um cartão.

## Testes

A cobertura unitária da ferramenta conduz pelo registry canônico os desfechos só com logs, só com resultado, com logs e resultado, sem saída, com resultado em spill e com falha, e então fixa o conteúdo durável e a ausência de um presenter de resultado. Uma regressão do host-mux usa um presenter apenas de chamada para provar que o frame de resultado carrega o conteúdo bruto exatamente uma vez e nenhuma view. Esses casos provam que metadados desatualizados não conseguem substituir o conteúdo final, sem que o host precise duplicar esse conteúdo.

Os snapshots sem chave do backend ACP (Agent Client Protocol) e do Code Mode na TUI executam um único programa externo que realiza duas chamadas bash aninhadas, registra em log `captured output` e retorna `CODE_ONE+CODE_TWO`. O log ACP persistido fixa o resultado completo; a superfície da TUI mostra um único cartão externo concluído contendo as duas linhas e nenhum cartão aninhado.

## Alternativas consideradas

**Anexar o valor de retorno aos metadados de logs.** Rejeitada porque os metadados duplicariam o renderizador, precisariam de um segundo contrato de formatação estável para cada raiz JSON e ainda deixariam escapar a substituição de conteúdo posterior às políticas ou as prévias de spill.

**Fazer merge dos metadados do presenter com `result.content`.** Rejeitada porque o conteúdo renderizado já contém os logs; o merge os duplicaria e exigiria uma deduplicação frágil.

**Encaminhar `result.content` por um presenter genérico de resultado.** Rejeitada porque o evento durável já carrega esse conteúdo e os consumidores de UI já têm um fallback genérico de conteúdo bruto. O host mux serializa, ao lado do evento, uma view de resultado pertencente à ferramenta, de modo que o encaminhamento duplicaria o conteúdo renderizado em um mesmo frame apenas para recriar o fallback; o worker padrão sozinho admite um orçamento de 64 MiB de payload variável antes da renderização.

**Criar um cartão por dispatch aninhado.** Rejeitada porque os valores intermediários são intencionalmente locais à execução e nunca voltados ao modelo. Vários cartões exporiam um rastro de implementação em vez da única operação de Code Mode que o modelo e o usuário invocaram.

## Consequências

A TUI e o JSON-RPC/Web exibem, por meio de seu fallback genérico de resultado, o mesmo conteúdo completo que o modelo recebe e que o replay persiste, incluindo as prévias de spill posteriores às políticas. A API do host retém o título do programa pendente sem duplicar o resultado bruto em um payload de view separado. Os novos resultados de `run_code` não carregam mais os metadados opcionais de logs, mas isso não exige incremento do formato de sessão: os registros existentes permanecem válidos porque a apresentação lê o conteúdo renderizado durável deles.
