# Agent Note: podar campos somente de escrita e um ajuste de roteamento morto do seam de fs

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-prune-write-only-fs-surface.md) | Português

## Problema

A [divisão do seam de fs](2026-06-26-fsspec-style-fs-seam.md) moveu o roteamento de leitura e a política do backend para `dsh-tool-fs` e `dsh-fs-policy`. Quatro partes da superfície mantiveram o formato anterior à divisão, preenchidas em toda chamada e lidas por ninguém:

1. **`STREAM_MIN_SIZE` + `FsIoInternals.streamMinSize` em `dsh-fs-local`**: *removidos antes desta mudança pela auditoria de ausência de ajustes fixos no código, que transformou o limite de roteamento na configuração `readStreamMinSize` de `dsh-tool-fs`; registrados aqui como parte da poda completa.* Originalmente (`packages/fs/fs-local/src/fsio.ts`, reexportado de `packages/fs/fs-local/src/index.ts`): zero leitores em qualquer lugar, incluindo o próprio código-fonte e os testes do fs-local. O backend não tem roteamento de leitura, pois `readWholeText`/`streamWholeText` são primitivas separadas entre as quais quem chama escolhe, e a constante de roteamento real fica no consumidor (`packages/fs/tool-fs/src/read.ts`, comparada com `info.size`). Dois espelhos do fato dos 10 MiB; o do backend estava morto, e o JSDoc do ajuste alegava uma sobreposição de "read routing" que não existia.
2. **`FsTarget.inputPath`** (`packages/fs/fs/src/types.ts`): todo backend e todo fake de teste tinha de fabricar um valor "diagnostics only" com zero leitores em produção; o plugin de política e toda mensagem de erro usam `targetKey`/`displayPath`. O produtor `listDir` expunha a oscilação semântica: os filhos de diretório recebiam o nome puro da entrada, que não era o "input" de ninguém.
3. **`FsEditOutcome.replacements` + `.replaceAll`** (`packages/fs/fs/src/types.ts`): `replacements` tinha zero leitores em produção (a política de correspondência única em si permanece: ela é imposta pelos throws `FS_AMBIGUOUS_EDIT`/`FS_EDIT_NOT_FOUND` dentro do backend, cuja mensagem de erro mantém a contagem interna); `replaceAll` era lido apenas por `formatEditOutput` em `packages/fs/tool-fs/src/edit.ts`, como um eco do argumento `replace_all` que a ferramenta já tem em mãos. Reduzido, `FsEditOutcome` é `{ version, before, after }`, paralelo aos campos de `FsWriteOutcome`, que são de fato descobertos pelo backend.
4. **`FileReadOutcome.limit` + `.version`** (`packages/fs/tool-fs/src/read-render.ts`): preenchidos pela ferramenta de leitura, mas `formatReadOutput` renderiza apenas `offset`/`lines`/`totalLines`/`truncatedByBytes`, e a emissão de `fs/observed` usa `info.version` diretamente, em vez de uma cópia vinda do outcome.

## Decisão

Apagar a constante do fs-local, a reexportação dela e o ajuste `streamMinSize` (os ajustes restantes de `FsIoInternals` são de fato usados pelos testes de escrita atômica); retirar `inputPath` de `FsTarget`; reduzir `FsEditOutcome` a `{ version, before, after }` e passar `replaceAll` para `formatEditOutput` a partir dos argumentos já analisados; retirar `limit`/`version` de `FileReadOutcome`. Os trechos colados em [filesystem.md](../../../../docs/core-data-structures/filesystem.md), o `packages/fs/fs/README.md` e os fakes de teste que tinham de fabricar os campos removidos encolhem junto com os tipos.

## Alternativas consideradas

### Por que não mantê-los?

Uma futura camada de permissão ou de contenção poderia querer o caminho anterior à resolução para o texto de erro, mas ela iria querer a *requisição*, que todo ponto de chamada ainda tem em mãos. "N occurrences replaced" poderia se tornar texto voltado ao modelo: uma mudança de comportamento a ser projetada quando for desejada, e a contagem interna do backend sobrevive para a mensagem de erro dele. Um rodapé de leitura poderia exibir `limit`, mas tudo o que o rodapé mostra já deriva de `lines`/`totalLines`. Enquanto isso, todo backend atual e futuro (remoto, nativo) teria de fabricar campos de transmissão que ninguém consome, e todo fake de teste teria de satisfazê-los.

## Verificação

As superfícies removidas deixaram de existir (`STREAM_MIN_SIZE`/`streamMinSize` em `dsh-fs-local`, `FsTarget.inputPath`, `FsEditOutcome.replacements`/`.replaceAll` e `FileReadOutcome.limit`/`.version`), enquanto o `replaceAll` do lado da requisição (`FsEditRequest`) e os campos de versão nos outros tipos de outcome ficam intocados; os fakes de teste encolheram junto com os tipos. O texto emitido por `formatEditOutput` fica inalterado para os dois ramos de `replace_all`, de modo que nenhuma saída esperada de snapshot mudou.

## Consequências

Os backends não ganham nenhuma obrigação nova; eles se livram de quatro campos que ninguém consumia. O trabalho de descoberta do fs (ferramentas de glob/grep) toca os mesmos arquivos de tipos do `dsh-fs`: uma sobreposição textual, não de projeto, que se reconcilia mecanicamente.
