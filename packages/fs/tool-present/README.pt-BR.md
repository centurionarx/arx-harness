# @arx-ai/arx-tool-present

[English](README.md) | Português

A ferramenta `present` valida arquivos regulares existentes por meio de `ctx.fs` e registra suas referências no turno aberto do agent (agente) chamador. Aceita arquivos criados por comandos de shell, programas externos ou ferramentas de sistema de arquivos. Não cria, envia, copia, congela nem lê o conteúdo dos arquivos. Caminhos relativos mantêm a grafia original e são resolvidos a partir do diretório de trabalho da Session proprietária, inclusive após um fork.

## Configuração

| Campo | Padrão | Significado |
|---|---:|---|
| `maxFiles` | `8` | Máximo de arquivos enviados por chamada, incluindo caminhos repetidos. |
| `maxMetadataBytes` | `16384` | Limite inclusivo de UTF-8 para todo o payload de `deliverables/presented`, incluindo turno, id da chamada, caminhos, descrições e pontuação JSON. |

Os dois limites devem ser inteiros positivos seguros; configuração inválida impede o carregamento. O limite de bytes restringe os metadados das referências, não o conteúdo dos arquivos. A ferramenta rejeita lista vazia, caminho em branco, diretório de trabalho ausente, turno proprietário ausente ou fechado, arquivo indisponível, link simbólico no componente final, diretório e arquivo especial. Erros de acesso do provedor são propagados. A validação verifica os metadados do caminho sem seguir o componente final e depois resolve e verifica os metadados do destino; nenhum acesso alternativo ao sistema de arquivos do Node contorna o provedor configurado.

## Ciclo de entrega

A entrada é `{ files: [{ path, description? }] }`; o resultado canônico é `{ turn, files }`. A ferramenta valida todos os arquivos antes de aceitar a lista. Cancelamento ou mudança do turno proprietário durante a validação faz a chamada falhar sem evento de entrega.

O observador final de `tools/result` acrescenta um evento `deliverables/presented` com `{ turn, callId, files }` somente para um resultado bem-sucedido aceito enquanto o turno original permanece aberto. Uma rejeição após a execução não publica entrega. O envelope da Session é responsável pela identidade da sessão; o id da chamada no payload também suporta chamadas aninhadas do Code Mode. O [plugin Web de entregas](../../client/ui-deliverables/README.md) combina esses eventos com locais de mutações bem-sucedidas e usa seu mecanismo existente de abertura de arquivos.

O registro contém falhas dos observadores. Se a inclusão falhar ou o turno fechar antes da publicação, nenhuma referência será registrada e o host registrará a falha; o resultado retornado confirma somente a validação de metadados. A persistência da Session mantém seu contrato normal de inclusão e flush assíncronos.

## Atribuição

Adaptado do [tool-present do DeepSeek Harness em c291e7961a515f6d7af9304e7fd1d257929aef26](https://github.com/deepseek-ai/deepseek-harness/tree/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/fs/tool-present), copyright 2026 DeepSeek, sob a [licença MIT](LICENSE). A adaptação do arx preserva a publicação após resultado bem-sucedido, usa o log de turnos existente do arx e acrescenta limites de metadados das referências e semântica explícita de falhas.

## Experiência do modelo

### Schema da ferramenta e resultado

#### O que o modelo vê

O [schema gerado da ferramenta](../../../docs/tool-catalog.md#arx-aiarx-tool-present) solicita que o modelo declare os arquivos de saída pedidos após gravá-los e antes da resposta final, incluindo arquivos criados pelo shell. O sucesso exibe `Validated file for delivery: <path>` para cada arquivo aceito, seguido de `Current file contents are not copied or preserved.` Não afirma envio, artefato imutável nem flush de persistência bem-sucedido. O texto de falha identifica o caminho ou limite inválido.

#### Efeito em tokens

O schema representa um custo fixo por requisição enquanto estiver carregado. Caminhos de arquivos e descrições opcionais permanecem na chamada da ferramenta e no resultado canônico; o resultado exibido acrescenta uma linha por arquivo. O evento de entrega exclusivo do log não acrescenta mensagem separada ao modelo.

#### Efeito no KV Cache

A visibilidade do schema afeta o prefixo da requisição. Resultados de ferramentas estendem o histórico somente por inclusão; o evento de entrega exclusivo do log não altera o prompt do modelo.

## Limitações conhecidas e trabalho adiado

- `deliverables/presented` é um evento obrigatório. Builds atuais o reconhecem pelo catálogo de eventos do repositório mesmo quando este plugin está desabilitado; builds antigos que não o reconhecem recusam reconstruir a sessão. Não há suporte a downgrade desse log.
- Os arquivos permanecem referências vivas: edições posteriores, exclusão, mudanças de permissão ou substituição podem alterar o que o usuário abre. Verificações de metadados não certificam o conteúdo nem impedem uma condição de corrida posterior no sistema de arquivos.
- O acesso aos metadados da origem segue o provedor; a ferramenta não realiza leitura adicional do conteúdo nem impõe limite de tamanho do arquivo.
- A publicação da entrega é uma operação de observador. Uma inclusão malsucedida não pode alterar retroativamente o resultado aceito da ferramenta; esse resultado informa intencionalmente apenas a validação.
- As descrições permanecem no evento durável e no resultado canônico; a linha compacta de arquivos da Web exibe nomes e caminhos.
- Caminhos relativos ao backend ou remotos exigem que o mecanismo existente de abertura do host suporte esse sistema de arquivos.
