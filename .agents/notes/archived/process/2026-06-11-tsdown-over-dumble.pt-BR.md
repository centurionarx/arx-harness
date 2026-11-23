# Agent Note: tsdown para o bundling de JS no lugar do dumble

Status: implemented
Archived: 2026-07-27

[English](2026-06-11-tsdown-over-dumble.md) | Português

## Problema

O build inicial usava o **dumble**, o wrapper de esbuild sem configuração da cordiverse com o qual o próprio Cordis upstream é construído: alinhamento máximo com as convenções dos pacotes vendorizados (ele lê cada package.json e infere entradas/formatos a partir do campo `exports`). Mas o dumble é um passivo como ferramenta da qual este repositório depende: v0.2.x, cerca de 530 downloads por semana no npm, na prática um único mantenedor, e nós o invocávamos por meio de um script de orquestração próprio (`scripts/build.ts`) porque ele não tem modo de workspace.

Hoje a saída do build só importa para `pnpm run build` + publint (nada é publicado ainda; dev/test/demo rodam sem build, via tsx), então o custo de troca está no ponto mais baixo agora e só cresce depois que os pacotes forem publicados.

## Decisão

Substituir o dumble pelo **tsdown** (baseado em rolldown, cerca de 2,5M de downloads por semana, apoiado pela VoidZero, com releases ativos):

- `tsdown.config.ts` na raiz com `workspace: ['vendor/*', 'packages/*/*']` (os globs explícitos restringem o bundling ao Cordis vendorizado e à árvore de pacotes TypeScript; `workspace: true` também descobriria os manifests (listas de metadados) de exemplos e os membros do workspace que não passam por bundling).
- Forma compartilhada: entrada `lib/types/index.js`, `outDir: 'lib'`, ESM, `platform: node`, `target: es2024`, `fixedExtension: false` (mantém `.js` para pacotes `"type": "module"`), `dts: false` (o tsc -b é dono das declarações), `clean: false` (lib/ também guarda a árvore intermediária `lib/types` do TSC). A entrada era originalmente `src/index.ts`; a [Agent Note do build TSC-first](2026-06-17-ts-build-config.md) depois passou o tsdown a fazer o bundling do JS emitido pelo TSC, para que o comportamento de transformação do TypeScript venha de um único compilador.
- Duas sobrescritas por pacote em vendor/ (nossas, como os tsconfigs regenerados; registradas em vendor/README.md): schemastery (`.mjs`/`.cjs` duplos via `outExtensions`), logger-console (duas passagens de entrada única, para que a classe base compartilhada seja embutida em cada entrada em vez de ir para um chunk com nome de hash, o que corresponde à forma publicada pelo upstream).
- `scripts/build.ts` excluído; `pnpm run build` = `tsc -b && tsdown` (a solução raiz é dona do grafo de emissão).

## Alternativas consideradas

- **Um script direto de esbuild**: o motor mais consolidado e nenhum risco de wrapper, mas mantém à mão a tabela de especificações por pacote que o modo de workspace do tsdown nos dá.
- **pkgroll**: o substituto direto mais próximo em filosofia, mas com 78 mil downloads por semana e baseado em Rollup: uma situação de manutenção estritamente mais fraca do que a do tsdown.
- **Manter o dumble**: alinhamento perfeito com o upstream, bus factor inaceitável.

## Consequências

As saídas de bundle de runtime ainda seguem a forma de entrada pública da era do dumble (`lib/index.js`, mais variantes específicas de pacote, como `lib/index.mjs`/`lib/index.cjs` do `schemastery` e `lib/browser.js` do `logger-console`); as declarações agora ficam em `lib/types`, conforme a [Agent Note do build TSC-first](2026-06-17-ts-build-config.md). Os externals ainda vêm das dependencies/peerDependencies de cada pacote. Abrimos mão da inferência do dumble pelo campo exports: pacotes novos com formas fora do padrão precisam de um `tsdown.config.ts` por pacote, em vez de apenas campos do package.json. Opção futura: o tsdown também poderia absorver o bundling de declarações (isolatedDeclarations) se o `tsc -b` algum dia virar o gargalo; isso seria uma nova Agent Note.
