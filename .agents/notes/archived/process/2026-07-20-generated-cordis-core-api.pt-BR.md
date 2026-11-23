# Agent Note: Gerar a referência da API central do Cordis

Status: implemented
Archived: 2026-07-27

[English](2026-07-20-generated-cordis-core-api.md) | Português

## Problema

Autores de plugins precisam das APIs detalhadas do Cordis por trás de `ctx`, do despacho de eventos, dos fibers, do registro de plugins e dos serviços. Os [catálogos de eventos e de serviços do Harness](2026-06-20-generated-cordis-catalog.md) gerados resumem intencionalmente os membros herdados do Cordis, então não substituem uma referência do Cordis no nível de método. Manter uma segunda cópia escrita à mão no site divergiria do código-fonte vendorizado e tornaria o renderizador mais um dono de documentação.

## Decisão

`scripts/cordis-core-api.ts` lê as declarações públicas e o JSDoc original de `vendor/cordis/src` com a API do compilador TypeScript. Um manifest (lista de metadados) explícito de páginas gera cinco arquivos em [`docs/cordis-catalog/core/`](../../../../docs/cordis-catalog/core/context.md): Context, Events, Fiber, Registry e Service. `scripts/gen-cordis-catalog.ts` grava essas páginas junto com os catálogos de eventos e de serviços do Harness, e `verify-cordis-catalog` rejeita saída desatualizada.

O gerador valida que as classes e os métodos documentados mantêm JSDoc descritivo, incluindo os contratos de parâmetros e de retorno não void. Ele emite cercas `ts cordis-catalog` só de declaração com o JSDoc original e depois renderiza a mesma descrição, os parâmetros e o contrato de retorno como Markdown legível. Os links de código-fonte apontam para os arquivos vendorizados, e as cinco páginas têm links cruzados entre si. Os catálogos do Harness continuam sendo o inventário exaustivo dos eventos e dos serviços `ctx.*` declarados pelo repositório; as páginas centrais documentam como as APIs herdadas do Cordis operam.

`website/docs.ts` publica os cinco arquivos canônicos sob as rotas correspondentes `/reference/cordis-api/` e `/en/reference/cordis-api/`. Os dois locales usam a fonte gerada em inglês até que o gerador emita páginas traduzidas, então trocar de idioma preserva a estrutura de navegação e a identidade das rotas.

## Alternativas consideradas

**Restaurar os antigos arquivos do site como Markdown canônico.** Isso recuperaria as páginas rapidamente, mas as assinaturas e a prosa delas poderiam divergir da implementação vendorizada, e o site voltaria a ter uma segunda fonte de documentação.

**Expandir no próprio lugar o nível herdado dos catálogos do Harness.** Esses catálogos respondem quais eventos e serviços do Harness existem. Misturar referências completas das classes do framework nas mesmas páginas obscureceria esse inventário e reverteria o nível herdado deliberadamente conciso deles.

**Publicar diretamente as declarações do código-fonte vendorizado.** Os arquivos de código-fonte são a autoridade, mas não oferecem páginas de tópico estáveis, ordenação pública curada nem navegação no site, e expõem corpos de implementação que não fazem parte do contrato da referência.

## Consequências

As cinco páginas da API do Cordis acompanham as atualizações do vendor por um único gerador determinístico e compartilham a gate de atualidade da documentação do repositório. O site ganha uma seção dedicada à API do Cordis sem conteúdo de site copiado, enquanto a navegação raiz e a em inglês permanecem estruturalmente idênticas.

O manifest de páginas é curado, então um tipo central do Cordis que se torne público precisa de uma entrada explícita no gerador. A prosa gerada é só em inglês, e a qualidade do JSDoc do código-fonte limita diretamente a qualidade da referência; a saída em chinês exige tradução no nível do gerador em vez de edição manual dos arquivos gerados.
