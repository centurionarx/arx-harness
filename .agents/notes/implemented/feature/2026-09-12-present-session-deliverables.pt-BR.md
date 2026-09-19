# Agent Note: Declarar arquivos existentes como entregas da sessão

Status: implemented

[English](2026-09-12-present-session-deliverables.md) | Português

## Problema

A linha Web de entregas reconhece locais de mutações bem-sucedidas do sistema de arquivos. Arquivos gerados por comandos de shell ou aplicações externas não possuem esse evento de mutação; portanto, apenas mencionar um caminho não os torna parte da lista de saídas de um turno.

## Decisão

O [plugin opcional tool-present](../../../../packages/fs/tool-present/README.md) valida referências a arquivos regulares existentes pelo sistema de arquivos configurado. Preserva caminhos relativos à Session e registra a lista aceita completa em `deliverables/presented`, atribuída ao turno atual e à chamada da ferramenta. O [acumulador Web](../../../../packages/client/ui-deliverables/src/client/turn-deliverables.ts) combina entregas explícitas com saídas de mutações na ordem da primeira ocorrência e elimina caminhos exatamente repetidos. Seu mecanismo existente de abertura continua responsável por resolver os caminhos da Session proprietária.

O pacote adapta o tool-present do DeepSeek Harness no commit `c291e7961a515f6d7af9304e7fd1d257929aef26`; o [aviso MIT](../../../../packages/fs/tool-present/LICENSE) permanece junto ao código. A implementação arx lê o turno atual do log de eventos existente, sem acrescentar uma projeção apenas para esse consumidor. A configuração de implantação limita a quantidade e os bytes UTF-8 do payload completo de metadados.

A publicação ocorre em `tools/result` após a política aceitar o resultado normalizado. O texto retornado confirma a validação do arquivo, não a persistência da entrega. A contenção do registro registra uma falha de inclusão do observador sem reescrever um resultado já aceito; um turno que fecha antes da publicação não recebe uma entrega tardia.

## Alternativas consideradas

**Inferir arquivos da saída do shell ou da prosa final.** Esses textos podem mencionar entradas, caminhos não relacionados ou saídas malsucedidas e não estabelecem que um arquivo existe. Uma declaração explícita validada pelo sistema de arquivos fornece à UI uma origem durável.

**Acrescentar durante execute.** A política posterior à execução ainda pode rejeitar o resultado da ferramenta. Publicar nesse ponto deixaria uma entrega para uma operação negada pela política final.

**Usar a finalização do conteúdo como uma transação que lança erros.** O callback existente é documentado como uma transformação total de conteúdo; alterar seu papel para um consumidor enfraqueceria o contrato da ferramenta. O observador de sucesso final preserva a semântica do registro, e o resultado afirma apenas o que a ferramenta pode estabelecer.

**Copiar todos os arquivos para um armazenamento de artefatos.** O armazenamento imutável de artefatos é uma capacidade separada com requisitos de retenção e acesso. Este pacote mantém referências a arquivos atuais e explicita essa limitação.

## Consequências

Saídas geradas pelo shell podem aparecer na mesma linha do turno e no mesmo mecanismo de abertura de referências inline dos arquivos gravados por ferramentas. A detecção existente de mutações e os históricos antigos permanecem válidos. Links simbólicos no componente final, arquivos indisponíveis, diretórios e entradas especiais rejeitam a declaração inteira; cancelamento ou turno desatualizado não publica lista parcial. Os limites de metadados não limitam o tamanho do conteúdo nem estabelecem permissão de leitura além das verificações de metadados do provedor.

Testes focados da ferramenta e dos invariantes cobrem limites de bytes e quantidade, falhas do provedor, cancelamento, rejeição após execução, falha de publicação, atribuição a Session e fork e desmontagem. Testes da UI cobrem saídas mistas e replay. O snapshot da aplicação com Loader e sem chave fixa o resultado de validação visível ao modelo e a entrega registrada de um arquivo criado externamente.

O evento é obrigatório, sem a marca ignorable: o catálogo atual o restaura mesmo quando o plugin present está desabilitado, enquanto runtimes antigos sem esse vocabulário recusam o log mais recente. Não há promessa de suporte a downgrade. Os testes dos SDKs TypeScript e Python com subprocessos preservam o evento completo na lista de eventos retornada e no observador de notificações, sem alterar a extração da resposta final.
