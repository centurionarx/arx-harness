# Agent Note: schema DSL tipado próprio para ferramentas em vez do schemastery

Status: implemented
Archived: 2026-07-26

[English](2026-06-11-custom-schema-dsl.md) | Português

## Problema

Os parâmetros de ferramenta precisam chegar ao modelo como JSON Schema padrão e, ao mesmo tempo, dar a quem escreve ferramentas um `execute(args)` tipado, sem casts. O Schemastery já atende à configuração de plugins, mas a API de autoria de ferramentas precisa de booleanos `required: true` por propriedade, e não do array `required` separado do JSON Schema.

## Decisão

Esta decisão foi substituída pelo [schema DSL unificado de valores JSON](2026-07-20-unified-json-value-schema-dsl.md), que mantém a pequena superfície de autoria e faz parâmetros e valores tipados compartilharem um único vocabulário. `ParameterSchemaSpec` mantém `required: true` por propriedade; `InferArgs<S>` mapeia as chaves obrigatórias para propriedades não opcionais; `parameterSchemaSpecToJsonSchema()` compila a raiz implícita de objeto aberto; e `defineTool()` une inferência, compilação e validação. As `ToolDefinition`s em JSON Schema bruto continuam aceitas por `ToolRegistry.register()` para MCP e outras ferramentas externas.

## Alternativas consideradas

O **Schemastery** (já vendorizado e usado para a Config de plugins) foi avaliado e rejeitado para este uso: ele mira validação / transformação contra o StandardSchema, não a *geração* de JSON Schema, então acrescentaria indireção sem produzir de forma limpa o formato de transmissão (wire format).

## Consequências

- Quem escreve ferramentas próprias do projeto recebe args tipados sem nenhum cast; o custo da ginástica de tipos fica dentro do pacote core (sancionado pela política de segurança de tipos do AGENTS.md).
- A nota unificada, dona do assunto, define os nós atuais, as restrições de literais, as uniões, a fronteira de valores JSON e as regras de abertura de objetos.
- O mapeamento de `InferArgs` tem teste de regressão no nível de tipos, depois de um bug inicial de opcionalidade.
