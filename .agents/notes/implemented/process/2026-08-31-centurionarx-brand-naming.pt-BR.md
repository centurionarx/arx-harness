# Agent Note: Centurionarx brand naming and the DeepSeek access config

Status: implemented

[English](2026-08-31-centurionarx-brand-naming.md) | Português

## Problem

O produto foi renomeado para arx, mas o nome do fornecedor do modelo ainda aparecia em cerca de 750 arquivos carregando três sentidos diferentes: a organização apresentada como responsável pelo produto, o provedor de LLM contra o qual o harness é executado e as credenciais que alcançam esse provedor. Nada distinguia esses sentidos, então superfícies de produto — o site, strings de UI, personas do agente, documentação — ainda apresentavam o harness sob a marca anterior, enquanto um find-and-replace indiscriminado teria quebrado exatamente a configuração que alcança o modelo.

## Decision

O nome do fornecedor `DeepSeek` aparece só na configuração de acesso ao modelo e em avisos de licença, em exatamente três classes de lugares:

- As variáveis de credencial `DEEPSEEK_API_KEY` e `DEEPSEEK_BASE_URL`, o login de conta do provedor e a documentação que os especifica.
- A identidade do provedor em configuração e código: o id do provedor, os nomes dos modelos (`deepseek-*`), o host da API, e as implementações de provider em `packages/llm` e seus READMEs.
- Avisos de licença e de copyright: arquivos `LICENSE`, `THIRD_PARTY_NOTICES.md`, fontes vendorizadas e linhas de atribuição que trazem o aviso de copyright do fornecedor.

O owner trata o arx Harness como produto novo de propriedade da Centurionarx, então nenhum outro trecho nomeia o fornecedor como autor, origem, dono ou referência de design do projeto: o repositório original e seus snapshots são "upstream", o produto de chat do fornecedor é "o cliente de chat de referência", e seus sites, escopos de pacote e nomes de design system que contêm o nome do fornecedor não aparecem. Toda outra menção é uso de marca e é escrita assim: a organização é Centurionarx, o produto é arx, o harness é arx Harness. Mensagens de commit seguem a mesma regra; o histórico publicado foi reescrito apenas nas mensagens como parte desta mudança, e os blobs ficaram intocados para que o conteúdo histórico permaneça byte-idêntico.

## Alternatives considered

- **Renomear também os identificadores de acesso** (variáveis de ambiente, id do provedor, nomes de modelo). Rejeitado: eles nomeiam a API real da DeepSeek; renomeá-los cortaria o vínculo entre a documentação e o serviço que as credenciais alcançam, e quebraria todo `.env` existente.
- **Mudar a marca só para frente, manter o histórico publicado.** Rejeitado por decisão da manutenção: o log de commits é uma superfície de produto, e menções de marca nele são lidas como identidade. O custo aceito é que clones existentes e os tags antigos `dsh-*` apontem para commits reescritos e que colaboradores precisem ressincronizar após o push forçado.
- **Substituição de texto indiscriminada pela árvore.** Rejeitada: sem classificação de sentido, teria reescrito a própria configuração de acesso; a substituição classificada por sentido foi a escolha.

## Consequences

- Uma busca por `deepseek` sem diferenciar maiúsculas pela árvore retorna apenas superfícies de config de acesso e avisos de licença: variáveis de credencial e seus docs, configuração e implementações de provider, e avisos de copyright e de terceiros. `scripts/upstream-sync.manifest.json` também guarda a URL do repositório original e o escopo de pacote enquanto o owner decide se aposenta as ferramentas de sincronização com o upstream.
- Reescrever o histórico invalida clones existentes; PRs que referenciam SHAs antigos e tags não remapeadas são as quebras conhecidas que a manutenção aceitou.
- [`verify-vendor-name`](../../../../scripts/verify-vendor-name.ts), um gate do `doc-sync`, remove as frases que contêm um aviso de copyright do fornecedor e então reprova uma linha que contém uma forma de marca (incluindo uma afirmação de autoria ou origem, como "built by" o fornecedor ou o "product" do fornecedor), ou uma ocorrência do nome do fornecedor que não é forma de acesso ao modelo e não tem termo de acesso a até oito palavras; seus caminhos permitidos, formas de marca, formas de acesso e termos de acesso são uma única lista fechada. Uma linha que mistura prosa de marca com um termo de acesso próximo passa, a menos que contenha uma forma de marca listada, então a revisão continua responsável por redações novas. Snapshots gravados também são varridos: uma resposta de modelo regravada que nomeia o fornecedor em prosa simples reprova até que a redação ou a lista fechada mude. `scripts/upstream-sync.manifest.json` fica permitido até a decisão do owner sobre as ferramentas de sincronização com o upstream.
- O `AGENTS.md` raiz carrega a regra de uma linha; esta nota é a casa do racional e da lista de classes preservadas.
