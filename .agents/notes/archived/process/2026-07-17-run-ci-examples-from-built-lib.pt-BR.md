# Agent Note: Executar os exemplos de CI a partir do lib compilado

Status: implemented
Archived: 2026-07-27

[English](2026-07-17-run-ci-examples-from-built-lib.md) | Português

## Problema

A CI inicializa os exemplos e os projetos de teste baseados em Cordis por meio de `node --import tsx` e do mapa `paths` do tsconfig raiz. Isso acrescenta o custo de transformação do TypeScript e altera a resolução de pacotes: os imports resolvem para o código-fonte do workspace em vez de seguir os `exports` do pacote até o `lib/` compilado.

Essas execuções, portanto, não testam o mesmo código nem o mesmo comportamento de resolução de um consumidor instalado. Um pacote pode passar na CI enquanto seu grafo de exports compilado está incompleto ou resolve de forma diferente.

## Decisão

A execução tem dois modos. `src` é o modo padrão de desenvolvimento local e usa tsx; `lib` é o modo estrito de CI e inicia os bins compilados com Node puro, sem tsx nem mapeamento de paths do tsconfig.

- Os subprocessos de CI que inicializam um exemplo ou um `cordis.yml` versionado usam o modo `lib`.
- As fixtures (dados de teste pré-montados) em TypeScript que só implementam um par ACP ou MCP e não carregam o Cordis rodam diretamente com Node. Uma regressão explícita de caminho de código-fonte pode permanecer no modo `src`.

### Topologia de resolução

Toda configuração de Cordis de teste precisa resolver seus módulos bare subindo a partir do diretório da configuração.

- `examples/` é um único membro do workspace pnpm e fornece a raiz de resolução compartilhada `examples/node_modules`.
- Toda configuração de Cordis de teste versionada, inclusive as configurações de snapshot e as fixtures pertencentes a pacotes, vive sob a árvore `examples/<agent>/` correspondente. Uma configuração pertencente a `packages/<group>/<package>/` é mapeada para `examples/<agent>/tests/fixtures/<group>/<package>/cordis.yml`; o driver de teste e as asserções permanecem locais ao pacote.
- Todo pacote nomeado por uma configuração de Cordis de exemplo é declarado tanto em `examples/package.json`, para a resolução em `lib`, quanto nas references do `tsconfig.json` raiz, para o modo `src`.

### Política de inicialização

O harness de teste compartilhado do Loader seleciona `src` ou `lib` a partir de `DSH_EXAMPLE_MODE`. A CI faz o build primeiro e seleciona `lib`; um modo não definido mantém o ciclo local rápido sobre o código-fonte.

## Alternativas consideradas

- **Manter a CI no tsx**: rejeitada porque preserva a sobrecarga de transformação e o comportamento de resolução exclusivo do código-fonte.
- **Usar lib em todo lugar**: rejeitada porque o desenvolvimento local exigiria um build antes de cada execução. O modo duplo mantém esse custo fora do ciclo de desenvolvimento.
- **Montar uma árvore `node_modules` privada por teste**: rejeitada porque duplica o scaffolding de consumidor. A raiz do workspace `examples/` dá a toda configuração de Cordis um caminho de resolução real e declarado.

## Consequências

- A CI valida os exports dos pacotes compilados sem que o tsx altere a resolução de módulos; o desenvolvimento local mantém o ciclo sobre o código-fonte sem build.
- A CI precisa fazer o build antes desses testes, e execuções manuais em `lib` podem observar artefatos locais desatualizados.
- As dependências das configurações de Cordis não são visíveis à análise normal de imports do TypeScript, então o `examples/package.json` e as references do tsconfig raiz precisam permanecer sincronizados com as configurações.
