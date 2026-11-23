# Agent Note: Os schemas de ferramenta fazem parte da montagem do prompt de sistema

Status: implemented
Archived: 2026-07-27

[English](2026-06-11-tool-schemas-in-prompt-assembly.md) | Português

## Problema

No formato de transmissão (wire format), os schemas de ferramenta trafegam em um campo `tools` dedicado da requisição ao modelo, não no texto do prompt. Arquiteturalmente, porém, "o que se diz ao modelo que ele pode fazer" é uma única preocupação coerente: as seções do prompt e a lista de ferramentas são montadas a partir das mesmas contribuições de plugins e consumidas no mesmo momento.

## Decisão

`PromptAssembly { sections, tools }`: o serviço de prompt de sistema coleta seções de texto ordenadas E schemas de ferramenta (o registry de ferramentas contribui automaticamente com um provedor). O loop consome uma montagem por etapa; os adaptadores mapeiam `sections` para o slot de sistema do provedor e `tools` para o campo `tools` do formato de transmissão. O waterfall (evento em cascata) `system-prompt/assemble` é, portanto, um ponto único de interceptação para tudo o que se diz ao modelo de antemão: a filtragem de ferramentas (ToolSearch / divulgação progressiva) é uma reescrita da montagem, do mesmo modo que as edições de prompt.

## Alternativas consideradas

**O loop consulta o registry de ferramentas separadamente do serviço de prompt**: divide uma única preocupação coerente entre dois seams, e toda interceptação que queira moldar "o que se diz ao modelo" (filtragem de ferramentas, plan mode) precisaria de dois listeners em duas superfícies em vez de uma única reescrita da montagem.

## Consequências

- Um único waterfall governa o contexto permanente do modelo; plugins como o plan mode podem trocar o texto do prompt e as ferramentas visíveis em um único listener.
- A interface da montagem é extensível por merge para slots futuros (sem um saco `extras` não tipado: a extensão é declaration merging).
- A leve surpresa conceitual (schemas em um serviço de "prompt") está documentada aqui e no README do pacote.
