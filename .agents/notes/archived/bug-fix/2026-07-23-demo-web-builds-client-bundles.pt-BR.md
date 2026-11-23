# Agent Note: demo:web faz o build dos bundles de plugin do cliente

Status: implemented
Archived: 2026-07-26

[English](2026-07-23-demo-web-builds-client-bundles.md) | Português

## Problema

O `dsh web` serve o bundle de cada plugin do cliente web em `GET /plugins/<id>/client.js`, resolvendo o caminho a partir do `exports["./client"]` do pacote (`lib/client.js`). Esses bundles são produzidos apenas pelo `pnpm run build` da raiz (`tsc -b` e depois as configurações `tsdown.client.ts` de cada pacote); a etapa `build:web` do Vite faz o build somente do shell do frontend. O `demo:web` e as instruções de Web UI do README rodavam apenas `build:web`, então, em um checkout sem um build completo anterior, todo bundle de plugin responde 404, o loader do cliente marca todos os plugins como falhos e a tela de inicialização mostra "Failed to load plugins". O build do shell do frontend terminava sem erro, o que escondia o artefato ausente atrás de uma falha de runtime no navegador.

## Decisão

O `demo:web` roda `npm run build` antes de `npm run build:web`, de modo que os bundles `lib/client.js` dos plugins existam antes que o `dsh web` os sirva. A seção de Web UI do README roda `pnpm run build && pnpm run build:web` para o checkout instalado em `~/.dsh/source`, cujo build o instalador nunca faz.

## Verificação

Depois do build completo, todos os oito endpoints `/plugins/<id>/client.js` retornam 200, e um carregamento de `http://127.0.0.1:3080` em um Chromium headless renderiza o shell sem o estado "Failed to load plugins".

## Alternativas consideradas

**Fazer o build dos bundles dentro do `dsh web` na inicialização.** O aplicativo roda a partir do código-fonte via tsx e não é dono de nenhuma etapa de build; embutir um build de artefato na inicialização do servidor atravessa a separação entre fonte e artefato e deixa toda execução mais lenta.

**Ampliar a configuração raiz do tsdown para emitir os bundles do cliente a partir de `pnpm run build:web`.** O `build:web` é o build de frontend do Vite; os bundles do cliente são uma passada separada do tsdown sobre `lib/types`. Juntar os dois confunde o build do shell com o build dos pacotes e ainda deixa o `build` da raiz como único produtor.

## Consequências

O `demo:web` agora paga o custo completo de `tsc -b && tsdown` a cada invocação, em vez de apenas o build do Vite. Esse é o preço de uma demo web executável a partir de uma árvore limpa; quem já fez o build pode invocar `dsh web` diretamente.
