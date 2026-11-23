# Agent Note: Remover os campos não usados do seam de web

Status: implemented
Archived: 2026-07-26

[English](2026-07-12-prune-unused-web-seam-fields.md) | Português

## Problema

A capacidade de web carrega valores de requisição/resultado/status que toda implementação entregue preenche, mas que nenhum consumidor de produção lê. `WebSearchResult.providerId` e `query`, e `WebFetchResult.providerId`, são ecos no resultado; `tool-web` formata apenas conteúdo/fontes/truncamento ou URL final/status/corpo/truncamento, e nenhum outro runtime os lê. Os provedores de busca retornam `WebProviderStatus.reason`, mas a resolução verifica apenas `available` e emite, intencionalmente, um diagnóstico genérico de indisponibilidade.

`WebFetchRequest.timeoutMs`, da mesma forma, nunca é definido por um chamador de produção. `tool-web` fornece apenas a URL, usa o timeout da definição da ferramenta mais `exec.signal` como prazo de quem chama, e conta com o padrão configurado do provedor local como última proteção. A sobreposição por requisição, sem uso, obriga `web-fetch-local` a expor `maxTimeoutMs`, a limitar duas fontes de timeout e a documentar/testar uma precedência que nenhum caminho do produto consegue selecionar. `WebExecContext` é outro wrapper de um campo só: todo chamador aloca `{ signal }` e todo provedor desembrulha `exec?.signal` imediatamente; não existe um segundo campo de controle de execução.

## Decisão

O seam de web omite os ecos `providerId` nos resultados de busca/fetch e o eco `query` na busca; os chamadores já são donos da requisição e da seleção de provedor. Os provedores expõem a disponibilidade como um método que retorna um booleano. As requisições de fetch não têm timeout por requisição nem o limite `maxTimeoutMs`; o provedor local mantém seu timeout padrão configurável e a ferramenta mantém o próprio prazo. Os métodos do provedor recebem diretamente um `AbortSignal` opcional, em vez de um wrapper `WebExecContext` de um campo só.

Todas as implementações de web e a ferramenta voltada ao modelo usam o contrato menor. A divisão de pacotes em interface/implementação/consumidor, a seleção de provedor, as citações de fontes, os dados de URL final/status, o relato de truncamento e os limites de segurança permanecem.

## Alternativas consideradas

**Manter resultados autodescritivos, prazos por requisição e um objeto de contexto de execução extensível.** Os ecos no resultado podem ajudar uma telemetria genérica, um timeout de requisição pode ajudar chamadores programáticos confiáveis, e o wrapper deixa espaço para controles futuros. Não existe nenhum consumidor nem segundo campo assim; carregar identidade duplicada, uma segunda política de prazo e o código de embrulhar/desembrulhar por todos os provedores torna o contrato atual mais difícil de implementar e de explicar. Se a telemetria ou o controle de orçamento por chamada chegar, ele deve definir qual prazo vence, onde a identidade do provedor é observada e se vários controles justificam um objeto de contexto.

## Consequências

Todo campo de requisição/resultado de web que foi mantido é consumido por código de produção ou é necessário para executar a requisição do provedor. A saída de busca/fetch visível à ferramenta, o fallback de provedor, o comportamento de abort, a última proteção do timeout configurado, o truncamento e as citações continuam cobertos, sem um ramo de precedência de timeout de requisição nem um wrapper de contexto de execução.

Os chamadores programáticos de pré-lançamento perdem os ecos de procedência no resultado e os prazos de fetch por requisição. O provedor ainda tem um timeout configurável por deploy e respeita o cancelamento, então a simplificação remove configurabilidade, e não um limite de segurança.
