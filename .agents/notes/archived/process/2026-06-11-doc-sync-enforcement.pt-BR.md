# Agent Note: Imposição do doc-sync

Status: implemented
Archived: 2026-07-26

[English](2026-06-11-doc-sync-enforcement.md) | Português

## Problema

O AGENTS.md promete que a documentação e o código ficam estritamente em sincronia, mas a promessa era verificada a olho. A revisão pegou divergência duas vezes: um exemplo do manual prático (cookbook) que contradizia a política de tipos e um README que citava a chamada errada de `registerAdapter`. Documentação fora de sincronia é pior do que nenhuma documentação, e esta base de código é construída principalmente por agents (agentes), que seguem gates com muito mais confiabilidade do que prosa (gates de qualidade mecânicas). Duas classes de divergência de documentação podem ser verificadas mecanicamente: blocos de código que não compilam mais e a tabela de taxonomia de eventos, que duplica as declarações `interface Events`.

## Decisão

Duas gates, que espelham o estilo já existente de `scripts/` (tsx ESM, um trabalho para cada):

1. **`doc-typecheck`** extrai todo bloco cercado ` ```ts ` de `README.md`, `docs/**` e `packages/*/README.md`, grava os blocos em um projeto temporário que estende o `tsconfig.json` raiz e o compila com `tsc -b`. O projeto temporário reutiliza o mapa `paths` do código-fonte e as referências de projeto da raiz, de modo que os exemplos da documentação enxergam o código-fonte enquanto o código vendorizado continua verificado sob as configurações do próprio tsconfig. Um bloco que é um esboço deliberado sai da verificação com uma info string explícita ` ```ts ignore-check `; o script informa a proporção de opt-out e falha se ela passar da metade, para que a válvula de escape não vire a norma sem que ninguém perceba.
2. **`verify-event-taxonomy`** extrai os nomes de eventos dos blocos `interface Events` em `packages/*/src` e da tabela de taxonomia em `docs/architecture.md` e verifica que os dois conjuntos coincidem exatamente. Verificar, não gerar: a tabela mantém as colunas Mode/Purpose escritas à mão; só o conjunto de nomes é verificado. (A entrega desta gate revelou três eventos que faltavam na tabela: `tools/change`, `llm/adapter-change`, `system-prompt/change`.) **Substituída** pelo [catálogo cordis gerado](2026-06-20-generated-cordis-catalog.md): esta gate e a tabela dela em `architecture.md` foram aposentadas em favor de `docs/cordis-catalog/events.md` + `docs/cordis-catalog/services.md`, totalmente gerados, e da gate de atualidade `verify-cordis-catalog` deles. As outras gates daqui (`doc-typecheck` e a emenda `verify-md-wrap` abaixo) não são afetadas.

As duas rodam por meio de um script `doc-sync` compartilhado do package.json, que os colaboradores invocam para as mudanças de documentação pertinentes e que o CI invoca de forma exaustiva. A decisão dos [hooks locais rápidos do Git](2026-07-22-fast-local-git-hooks.md) mantém fora dos hooks de commit e de push esse trabalho selecionado por superfície.

**Emenda (2026-06-17):** uma terceira gate, **`verify-md-wrap`**, foi incorporada depois ao `doc-sync`. Ela analisa cada arquivo Markdown do escopo (`README.md`, `docs/**`, `packages/*/README.md`, mais `AGENTS.md` / `packages/AGENTS.md`) com `mdast-util-from-markdown` + GFM e falha diante de qualquer nó `paragraph` que ocupe mais de uma linha do arquivo-fonte, o que impõe a regra de escrita "uma linha física por parágrafo" de docs/AGENTS.md. Vale o mesmo princípio de verificar, não gerar: ela informa as quebras forçadas e nunca reescreve, então não acrescenta ruído de formatação. O `doc-sync` agora são três gates.

## Alternativas consideradas

- **Relatórios de referência do API-extractor** ([a proposta adiada](../../proposed/process/2026-06-11-api-extractor-reports.md)): adiados deliberadamente: pouco valor para um monorepo interno em que os revisores já veem o diff do código-fonte, e uma dependência pesada e temperamental.
- **Gerar a tabela de taxonomia a partir do código-fonte**, em vez de verificar os nomes: rejeitado por ser mais maquinário do que o problema justificava; a tabela manteve as colunas Mode/Purpose escritas à mão até que [o catálogo cordis gerado](2026-06-20-generated-cordis-catalog.md) substituísse a verificação por completo.

## Consequências

- A divergência de documentação nas classes verificáveis faz o `doc-sync` e o CI falharem, em vez de esperar que um revisor perceba. É uma instância do princípio "gates mecânicas acima da prosa".
- Fazer os trechos da documentação compilarem custa alguns imports/`declare`s de stub; a proporção de `ignore-check` precisa ficar baixa, ou a gate é teatro (a guarda de proporção impõe isso).
- A verificação da taxonomia cobre apenas nomes: uma coluna Mode ou Purpose errada ainda precisa de revisão humana.
- Os relatórios de API continuam disponíveis para reavaliação se os pacotes algum dia forem publicados externamente.
