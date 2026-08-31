# Agent Note: Centurionarx brand naming and the DeepSeek access config

Status: implemented

[English](2026-08-31-centurionarx-brand-naming.md) | 中文

## Problem

O produto foi renomeado para arx, mas o nome do antigo dono ainda aparecia em cerca de 750 arquivos carregando três sentidos diferentes: a organização por trás do produto, o provedor de LLM contra o qual o harness é executado e as credenciais que alcançam esse provedor. Nada distinguia esses sentidos, então superfícies de produto — o site, strings de UI, personas do agente, documentação — ainda apresentavam o harness como da DeepSeek, enquanto um find-and-replace indiscriminado teria quebrado exatamente a configuração que alcança o modelo.

## Decision

`DeepSeek` aparece em exatamente três classes de lugares, todos nomeando a configuração de acesso ao modelo:

- As variáveis de credencial `DEEPSEEK_API_KEY` e `DEEPSEEK_BASE_URL` e a documentação que as especifica.
- A identidade do provedor em configuração e código: o id do provedor, os nomes dos modelos (`deepseek-*`), o host da API, e as implementações de provider em `packages/llm` e seus READMEs.
- Atribuições de terceiros: `THIRD_PARTY_NOTICES.md`, lockfiles, links históricos para o repositório anterior ao rename e suas issues, as ferramentas de rebrand que nomeiam os identificadores antigos que mapeiam, e citações de decisões de design de produtos externos (por exemplo, a geometria de UI do DeepSeek Chat que o cliente referencia).

Toda outra menção é uso de marca e é escrita assim: a organização é Centurionarx, o produto é arx, o harness é arx Harness. Mensagens de commit seguem a mesma regra; o histórico publicado foi reescrito apenas nas mensagens como parte desta mudança, e os blobs ficaram intocados para que o conteúdo histórico permaneça byte-idêntico.

A árvore congelada `.agents/notes/archived/` mantém a redação original; notas arquivadas nunca são reescritas, e a verificação delas aceita a nomenclatura histórica na árvore congelada.

## Alternatives considered

- **Renomear também os identificadores de acesso** (variáveis de ambiente, id do provedor, nomes de modelo). Rejeitado: eles nomeiam a API real da DeepSeek; renomeá-los cortaria o vínculo entre a documentação e o serviço que as credenciais alcançam, e quebraria todo `.env` existente.
- **Mudar a marca só para frente, manter o histórico publicado.** Rejeitado por decisão da manutenção: o log de commits é uma superfície de produto, e menções de marca nele são lidas como identidade. O custo aceito é que clones existentes e os tags antigos `dsh-*` apontem para commits reescritos e que colaboradores precisem ressincronizar após o push forçado.
- **Substituição de texto indiscriminada pela árvore.** Rejeitada: sem classificação de sentido, teria reescrito a própria configuração de acesso; a substituição classificada por sentido foi a escolha.

## Consequences

- Uma busca por `deepseek` sem diferenciar maiúsculas pela árvore retorna apenas superfícies de config de acesso: variáveis de credencial e seus docs, configuração e implementações de provider, avisos de terceiros e o arquivo congelado.
- Reescrever o histórico invalida clones existentes; PRs que referenciam SHAs antigos e tags não remapeadas são as quebras conhecidas que a manutenção aceitou.
- O `AGENTS.md` raiz carrega a regra de uma linha; esta nota é a casa do racional e da lista de classes preservadas.
