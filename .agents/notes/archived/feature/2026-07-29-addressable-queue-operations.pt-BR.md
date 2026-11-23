# Agent Note: endereçar ocorrências pendentes da fila para edição e remoção

Status: implemented
Archived: 2026-07-31

[English](2026-07-29-addressable-queue-operations.md) | Português

## Problema

A fila da Web renderizava mensagens pendentes, mas não conseguia editar nem excluir uma linha. `MessageId` era insuficiente como endereço porque quem chama pode enfileirar a mesma mensagem imutável mais de uma vez. O navegador também inferia a retirada da fila a partir de eventos de turno e de status, então uma operação de linha que disputasse com a reivindicação pelo driver não tinha resultado autoritativo.

## Decisão

**Cada ocorrência FIFO aceita tem identidade própria.** O AgentLoop cria um `InboxItemId` opaco e publica um `InboxItem` que contém esse id, a `UserMessage` identificada e o seu posicionamento `queued | steering` no momento da aceitação. Reutilizar um `MessageId` cria identidades de inbox distintas. A injeção contorna as FIFOs e não recebe identidade de inbox.

**A mutação termina na reivindicação pelo driver.** `Agent.updateInbox(id, action)` busca de forma síncrona na FIFO pendente de enfileirados. A edição substitui o conteúdo congelado e preserva `InboxItemId`, `MessageId`, origem, política de despertar e posição. A remoção emite o descarte terminal da ocorrência. Ocorrências de steering e ocorrências reivindicadas pelo driver retornam `not-found`, então as operações de fila nunca reescrevem a entrada do turno ativo nem o histórico durável.

**O registro vivo é autoritativo.** `agent/inbox/enqueue`, `update`, `dequeue` e `discard` mantêm no Host um espelho das ocorrências enfileiradas. Uma atualização ou um evento terminal reentrante de forma síncrona pode chegar ao espelho antes do listener externo de enqueue; o espelho retém esse resultado ainda não visto durante o despacho atual e o incorpora ao enqueue, de modo que a ordem de registro dos listeners não pode publicar conteúdo desatualizado nem uma linha fantasma. A transmissão envia snapshots completos de `session/queue`, em vez de palpites incrementais. A reconexão envia a linha de base atual, e toda mutação de enfileirados ou evento terminal a substitui. O cliente não aplica nenhuma edição otimista e nunca retira uma linha com base em eventos duráveis de turno ou em mudanças de status.

**Os endereços da fila exigem um Agent vivo.** `session.updateQueue` consulta apenas o registry de Agents montados e nunca retoma uma sessão fria: um `InboxItemId` é local ao processo e não pode nomear trabalho depois de uma reinicialização ou de um dispose. Um Agent ausente e uma ocorrência reivindicada pelo driver retornam ambos `queue-item-not-found`.

**As ações da Web endereçam apenas a Queue.** O Host exclui o steering pendente de `session/queue`; o steering mantém o seu caminho durável de transcript já existente depois do consumo. O QueueDock se oculta enquanto está vazio, renderiza diretamente uma única ocorrência pendente e, com duas ou mais ocorrências, usa por padrão um cabeçalho recolhido `"<n> mensagens na fila"`, que expande ou recolhe a lista completa. O cabeçalho expõe `aria-expanded` e `aria-controls`; a lista expandida rola dentro de um limite de altura de 180px. Uma edição ou mutação ativa mantém suas linhas visíveis, e esvaziar a fila restaura o padrão recolhido para a fila seguinte. As linhas visíveis expõem editar e excluir, mas nenhum controle de enviar agora. A UI deriva os tipos de linha da fila e de mutação do contrato de runtime `SessionFace`, em vez de importar o plugin de conexão, de modo que a cooperação entre plugins continua passando por serviços e snapshots. A edição só fica disponível quando todos os blocos de conteúdo são texto; o editor não pode descartar em silêncio blocos que não são texto. Uma linha em edição expõe apenas salvar e cancelar, com Enter e Escape como equivalentes de teclado. Excluir remove exatamente aquela ocorrência.

## Alternativas consideradas

**Endereçar linhas por `MessageId`.** Rejeitada porque uma mensagem imutável pode ser enviada repetidas vezes; editar ou excluir pela identidade da mensagem afetaria uma ocorrência ambígua.

**Aplicar mutações otimistas no navegador.** Rejeitada porque a reivindicação pelo driver e outro cliente podem vencer antes da ação do Host. Esperar pelo snapshot autoritativo torna visível a fronteira de posse e permite que `queue-item-not-found` relate uma disputa real.

**Incluir o steering pendente no protocolo de mutação da fila.** Rejeitada porque o QueueDock não tem interação de steering, e editar ou excluir a entrada do turno ativo ampliaria esta funcionalidade além do seu consumidor atual. Uma interação dedicada de steering é dona desse contrato de entrega.

**Expor uma operação de promoção restrita ao protocolo.** Rejeitada porque nenhuma interação de produto reordena a Queue. Uma operação pública sem consumidor atual acrescentaria semântica de ordenação e testes para um uso especulativo.

**Retomar um Agent frio para uma operação de fila.** Rejeitada porque a identidade durável da sessão não preserva a capacidade de inbox local ao processo. A retomada só pode produzir `not-found`, depois de criar estado vivo sem relação com o pedido.

## Verificação

Os testes de contrato do AgentLoop seguram a admissão do prompt enquanto editam e removem ocorrências enfileiradas exatas, rejeitam mutações de ocorrências de steering e verificam o turno independente resultante e os eventos terminais de ciclo de vida. Os testes de schema e de proxy do Host cobrem snapshots autoritativos restritos aos enfileirados, a ordem de mutações reentrantes síncronas, a reconexão, a rejeição de Agent frio, os erros tipados de not-found e o transporte RPC. Os testes do runtime do cliente e do QueueDock cobrem a projeção não otimista, a apresentação de linha única, o recolhimento padrão com várias linhas, a visibilidade forçada pela interação, a redefinição após o esvaziamento, a expansão, a edição restrita a texto, as affordances de salvar e cancelar, a remoção, as disputas de retirada e a edição desabilitada para conteúdo misto. Cenários de navegador sem chave capturam o cabeçalho recolhido padrão antes de expandir a fila e de acionar as ações expostas de editar e excluir por meio da composição Web já construída e da transmissão HTTP/SSE real.

## Consequências

O trabalho enfileirado ganha operações precisas por linha sem se tornar histórico durável da sessão. A identidade de ocorrência é uma capacidade viva, local ao processo, e desaparece na reivindicação, no cancelamento, no dispose ou na reinicialização; a reconexão recupera apenas os itens enfileirados que o Agent vivo ainda mantém. A edição exclui conteúdo misto até que um editor consiga preservar todos os blocos, enquanto o steering pendente continua fora desta superfície de operações.

O protocolo agora transporta snapshots completos da fila a cada mudança. Espera-se que as filas continuem curtas, então a recuperação determinística e a convergência entre vários clientes são preferidas a um protocolo de mutação incremental.
