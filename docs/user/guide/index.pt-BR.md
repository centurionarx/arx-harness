# Usar a Web UI

[English](index.md) | Português

Inicie a Web UI seguindo o [README da raiz](../../../README.pt-BR.md#run); o comando imprime a URL. Este guia começa com o servidor já em execução. O processo `arx` usa o diretório de onde foi iniciado como local padrão no sistema de arquivos, mas uma Web UI nova não tem workspace selecionado até você adicionar um.

## Configurar um modelo

Abra **Settings → Models**, escolha **Add provider**, selecione seu provedor e salve a credencial dele. Nenhum provedor vem configurado; uma configuração válida torna a rota de modelo utilizável sem reiniciar o servidor.

O [guia de configuração de modelos](./providers.pt-BR.md) cobre outros provedores e endpoints personalizados compatíveis com OpenAI.

## Escolher um workspace

Clique em **Choose workspace**, adicione o diretório do projeto em que você iniciou `arx` e selecione-o. O campo de mensagem da sessão fica indisponível até que você selecione um workspace.

## Executar uma tarefa

Inicie uma sessão e envie:

> Resuma este repositório e identifique seus principais pacotes.

O agent (agente) pode ler e editar arquivos do workspace, executar comandos, delegar trabalho e manter um plano. A Web UI pede confirmação antes das operações que exigem aprovação pela política de permissões ativa.

## Continuar

- [Configurar modelos](./providers.pt-BR.md)
- [Suporte a plataformas](./platforms.pt-BR.md)
- [Acesso e segurança](./security.pt-BR.md)
- [Usar o SDK Python](./python-sdk.pt-BR.md)
- [Usar outros modos da CLI](../../../apps/cli/README.md)
- [Desenvolver um plugin](../develop/basic/index.md)
