# Configurar modelos

[English](providers.md) | Português

Este guia pressupõe que você iniciou a Web UI pelo [README da raiz](../../../README.pt-BR.md#run). As mudanças de modelo entram em vigor na próxima requisição, sem reiniciar o servidor.

## Adicionar um provedor do catálogo

Nenhum provedor vem configurado: uma instalação nova não serve modelos até que você adicione um, e a escolha é sua.

Abra **Settings → Models**, escolha **Add provider**, selecione um provedor como Anthropic ou OpenAI, informe a chave de API e salve. O catálogo instalado fornece o endpoint, o protocolo e a lista de modelos.

As chaves só podem ser gravadas. Depois de salvar, a página recebe um descritor com o segredo oculto, nunca o segredo literal. A chave fica em `$ARX_HOME/.credentials.yaml`, enquanto as configurações guardam apenas sua referência de credencial.

Provedores com autenticação nativa precisam das próprias credenciais nativas. Bedrock, Vertex, Azure e Codex usam, respectivamente, credenciais AWS e uma região, um projeto ADC, uma `api-version` e OAuth; preencher apenas o campo de chave de API não os configura.

## Adicionar um provedor personalizado

Escolha **Add a custom provider** para um gateway corporativo, servidor próprio ou provedor ausente do catálogo instalado. Informe um Provider ID em minúsculas, URL base, protocolo de API, credencial e pelo menos um modelo.

![Formulário de provedor personalizado: Provider ID, nome de exibição, URL base, protocolo de API e chave de API](providers-custom-form.png)

O Provider ID é permanente porque requisições, sessões salvas, modelos padrão e referências de credenciais o utilizam. Para renomear um provedor, adicione outro e exclua o antigo. O nome de exibição, a URL base, o protocolo, a credencial e os modelos continuam editáveis.

Em **Model catalog**, escolha **Fetch available models** para consultar a URL base e a credencial exibidas no formulário. Selecionar candidatos atualiza o rascunho; o provedor só é armazenado quando você salva. Provedores de catálogo usam o catálogo instalado sem uma requisição de rede.

### Um servidor local de modelos

Ollama, llama-server, vLLM e LM Studio falam o protocolo compatível com OpenAI, então cada um é um provedor personalizado apontando para `127.0.0.1`. Não há chave paga envolvida, mas a rota ainda precisa de uma *referência* de credencial: um perfil que não a nomeia é recusado com `No API key for provider` antes de qualquer requisição sair do processo. Nomeie uma variável de ambiente e dê a ela qualquer valor não vazio; um servidor local ignora o cabeçalho `Authorization`.

```yaml
llm-pi-ai:
  providers:
    ollama:
      displayName: Ollama
      apiKeyEnv: OLLAMA_API_KEY
      api: openai-completions
      baseURL: http://127.0.0.1:11434/v1
      models:
        - id: qwen3:8b
          contextWindow: 40960
```

Informe o `contextWindow` real de cada modelo. Um modelo inserido sem esse campo herda um padrão de 262144 tokens que a maioria dos modelos locais não suporta. A compactação automática lê esse número para decidir quando resumir; por isso, a sessão ultrapassa a janela real do modelo antes do início da compactação.

### Entrada de imagens

Um modelo inserido manualmente é tratado como somente texto até declarar o contrário, porque nada pode consultar quais modalidades um endpoint aceita. Anexar uma imagem a esse modelo é recusado antes do envio, com o nome do modelo.

Um modelo com visão em um provedor personalizado precisa, portanto, de uma linha. O formulário não tem campo para ela; acrescente `input` ao modelo em `$ARX_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

`input` aceita `text` e `image` e se aplica somente àquele modelo, então uma rota pode servir os dois tipos. Omitir o campo, ou escrever uma lista vazia, que significa o mesmo, preserva o que o catálogo instalado registra para esse modelo e usa o `defaultInput` da rota para um modelo que o catálogo não descreve.

Se todos os modelos inseridos manualmente aceitam imagens, defina o fallback uma vez na rota, em vez de em cada modelo:

```yaml
llm-pi-ai:
  providers:
    vision-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://vision.example/v1
      defaultInput: [text, image]
      models:
        - id: first-model
        - id: second-model
```

`defaultInput` é um fallback, não uma substituição, e seu padrão é `[text]`: em um provedor de catálogo, ele só responde pelos modelos que o catálogo não descreve, então nunca remove imagens de um modelo de catálogo que as aceite. Restrinja um desses modelos com seu próprio `input`. Um provedor de catálogo não tem uma lista `models` para receber esse campo; escreva-o em `modelOverrides`, usando o id do modelo como chave:

```yaml
llm-pi-ai:
  providers:
    anthropic:
      modelOverrides:
        claude-sonnet-4-5:
          input: [text]
```

Toda lista deve nomear pelo menos uma modalidade, exceto a do próprio modelo, na qual uma lista vazia significa o mesmo que omiti-la. Uma modalidade desconhecida é recusada onde quer que seja escrita.

Os dois campos declaram uma característica do endpoint, em vez de verificá-la. Um modelo que declara imagens que seu endpoint não aceita não é detectado aqui; o provedor rejeita a requisição.

### Compatibilidade de requisições

Um gateway pode ter uma chave válida em um endereço acessível e ainda recusar todas as requisições. O pi-ai decide os campos de uma requisição, como o papel do prompt de sistema, o campo que limita a saída e a transmissão do nível de raciocínio, a partir da URL do endpoint. Um endereço que ele não reconhece é tratado como se fosse a própria OpenAI. A maioria dos gateways compatíveis com OpenAI recusa pelo menos algo que a OpenAI aceita.

Dois casos respondem pela maior parte disso. Um modelo que declara raciocínio recebe seu prompt de sistema como `role: "developer"`, que muitos gateways rejeitam, e o limite de saída vai em `max_completion_tokens`, que um servidor que só conhece `max_tokens` recusa. O formulário não tem campo para nenhum deles; corrija-os na rota em `$ARX_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      compat:
        supportsDeveloperRole: false
        maxTokensField: max_tokens
      models:
        - id: my-model
```

O `compat` de uma rota é o padrão dos seus modelos, e o do próprio modelo prevalece campo a campo, então um modelo pode ser corrigido sem redeclarar a rota:

```yaml
      models:
        - id: my-model
        - id: my-reasoner
          compat:
            thinkingFormat: deepseek
```

O que nenhum dos dois define preserva o valor do catálogo instalado para aquele modelo; o que o catálogo não descreve usa a detecção do pi-ai. Dê um valor a cada opção que nomear: uma chave vazia (`supportsDeveloperRole:`) é recusada em vez de ignorada, porque um valor vazio apagaria o conhecimento do catálogo sem declarar nada no lugar. Um nome que nenhum protocolo aceita também é recusado, e a mensagem lista os nomes disponíveis.

Cada opção pertence aos protocolos que a declaram, então uma opção válida em uma `api` pode ser recusada em outra; a mensagem informa o que aquele protocolo oferece. Assim como `input` acima, uma opção declara uma característica do endpoint, em vez de verificá-la: definir uma opção de que o gateway não precisa simplesmente envia uma requisição diferente.

Cada opção, seus valores aceitos e os protocolos que a recebem estão listados em `PiAiCompatProfile` na [referência gerada de configuração de `arx-llm-pi-ai`](../../config-catalog.md#arx-aiarx-llm-pi-ai), derivada do código-fonte para não ficar atrás do que o adaptador aceita.

## Selecionar um modelo

Os provedores configurados aparecem no seletor de modelos. Selecionar um modelo também o torna padrão para novas sessões. Uma sessão que já enviou uma requisição mantém o modelo registrado no próprio log.

Se um padrão salvo nomear um provedor excluído, o campo de mensagem exibe **Select model** e bloqueia a entrada até que outro modelo seja selecionado.

## Solução de problemas

- **`MISSING_CREDENTIAL`**: armazene a chave do provedor pela página Models ou forneça a variável de ambiente referenciada.
- **`UNKNOWN_MODEL`**: selecione um modelo configurado ou adicione o modelo ausente ao provedor personalizado.
- **A busca de modelos disponíveis retorna 401**: confira a chave. A descoberta de modelos chama o endpoint `GET /models` compatível com OpenAI; insira os modelos manualmente nos endpoints que não o oferecem.
- **O gateway recusa todas as requisições embora chave e URL estejam certas**: seus campos de requisição diferem dos da OpenAI. Comece com `compat.supportsDeveloperRole: false` e `compat.maxTokensField: max_tokens` na rota.
- **Somente modelos com raciocínio falham**: o pi-ai envia o prompt de sistema deles com o papel `developer`, que o gateway rejeita. Defina `compat.supportsDeveloperRole: false`.
- **Uma opção de compatibilidade é recusada por não ter valor**: a chave foi escrita sem nada depois dos dois-pontos. Dê a ela um valor ou remova-a para preservar o do catálogo instalado.
- **Uma imagem é recusada antes do envio**: o modelo não declara a modalidade de imagem. Dê ao modelo de um provedor personalizado `input: [text, image]`; uma rota chat-completions somente texto não pode ser configurada para aceitar imagens.
- **O provedor rejeita uma requisição com imagem**: o modelo declara imagens que seu endpoint não aceita. Remova `image` da lista que a permitiu, seja o `input` do modelo ou o `defaultInput` da rota, e inicie uma sessão nova: a imagem anexada permanece no log da sessão, então a mesma requisição se repete até que a sessão deixe de usá-la.

## Configuração avançada

O [catálogo gerado de configuração de plugins](../../config-catalog.md) lista todos os campos e padrões aceitos por cada plugin; [`arx-llm-pi-ai`](../../config-catalog.md#arx-aiarx-llm-pi-ai) é a seção de provedor que esta página configura. A referência de [`arx-llm-pi-ai`](../../../packages/llm/llm-pi-ai/README.md) define a configuração direta de `settings.yaml`, a resolução do catálogo, os controles de raciocínio, as credenciais e os erros do adaptador.
