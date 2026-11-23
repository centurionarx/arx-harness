# Agent Note: Fixar o conteúdo do cabeçalho de requisição em um único cenário de snapshot

Status: implemented
Archived: 2026-07-26

[English](2026-07-06-pin-request-header-content-in-one-scenario.md) | Português

## Problema

Uma suíte de snapshots de ACP (Agent Client Protocol) precisa provar exatamente o prompt de sistema composto e a lista de schemas de ferramenta enviados em cada `request/header`, mas duplicar esse conteúdo dentro de cada `session.jsonl` faz uma edição de prompt ou de schema reescrever dezenas de registros JSON gigantes de uma linha só. Manter um único cabeçalho bruto evita a duplicação, mas ainda torna ruim a revisão do prompt: a prosa fica escapada como JSON em uma única linha e misturada a milhares de caracteres de schemas de ferramenta.

## Decisão

Exatamente um cenário por classe de composição de cabeçalho é marcado com `pinsHeader`. O diretório dele divide o pin por formato de revisão: `system-prompt.expected.md` contém a sequência completa e normalizada de prompts como Markdown comum, `tool-schemas.expected.json` contém a sequência completa de schemas correspondente como JSON estruturado, e `session.jsonl` retém a configuração, o motivo e qualquer prefixo visível ao modelo, enquanto armazena `header.system` e `header.tools` como `"{{system}}"` / `"{{tools}}"`. Todo outro JSONL usa os mesmos tokens de prompt e de ferramentas e também tokeniza o conteúdo do prefixo de sessão. A mecânica do pin vive em [`dsh-acp-snapshot`](../../../../packages/support/acp-snapshot/README.md), cuja fábrica de suítes impõe um pin por classe.

Os normalizadores puros `scrubSystemPrompts` e `scrubToolSchemas` tokenizam de forma independente todo cabeçalho completo armazenado. `scrubRequestHeaders` também tokeniza o conteúdo do prefixo de sessão nos cenários que não fixam o cabeçalho, mantendo a contagem de cabeçalhos, a presença de campos, a configuração, o motivo e a contagem de mensagens do prefixo. A gravação e a escrita de volta do refresh aplicam o scrub apropriado antes de escrever o JSONL e regeneram os dois sidecars a partir da sequência normalizada de cabeçalhos completos ao vivo, de modo que nenhum dos dois caminhos consegue reintroduzir o volume de prompt/schema no JSONL nem deixar desatualizado um artefato de revisão.

As guardas fazem a divisão se impor sozinha. Em disco, todo `session*.jsonl` é um ponto fixo dos scrubbers de prompt e de schema, apenas as fixtures (dados de teste pré-montados) que não fixam o cabeçalho precisam ser pontos fixos do scrub completo de cabeçalho, os dois sidecars existem exatamente ao lado das fixtures que fixam o cabeçalho, em formatos canônicos terminados em nova linha, e cada classe tem um pin. Ao vivo, todo `request/header` produzido por um pai, um filho de spawn, um filho de fork, uma requisição inicial, uma retomada ou uma mudança dentro da instância precisa corresponder à sequência reconstruída da classe depois da normalização de valores voláteis. Um cabeçalho sem um prompt em string, sem uma lista de ferramentas com valor de array ou além da contagem de cabeçalhos alterados declarada pelo pin falha de forma explícita.

Um único pin cobre a suíte inteira porque toda sessão (pai, filho de spawn, filho de fork) compõe a lista de ferramentas idêntica e o prompt idêntico, a menos do cwd, e a guarda de uniformidade faz a suíte falhar no momento em que isso deixar de valer. Se a composição do cabeçalho algum dia passar a depender da sessão por design (um conjunto restrito de ferramentas para subagents, por exemplo), o formato divergente ganha seu próprio cenário de pin.

## Alternativas consideradas

- **Regravar ou editar à mão toda fixture a cada mudança**: preserva os cabeçalhos exatos, mas enterra os diffs de comportamento sob conteúdo duplicado de prompt e de schema.
- **Fazer o scrub apenas no momento da comparação, mantendo as fixtures brutas**: deixa as comparações passarem enquanto as fixtures commitadas retêm conteúdo duplicado desatualizado e são reescritas por inteiro na gravação seguinte. Os tokens armazenados declaram com honestidade o que cada JSONL não fixa.
- **Fazer o scrub em todo lugar, sem fixar em lugar nenhum**: perde o único registro de ponta a ponta do cabeçalho composto tal como foi de fato enviado (montagem do prompt, ordem das ferramentas registradas, schemas completos). O catálogo de ferramentas gerado documenta cada ferramenta isoladamente; só uma fixture real fixa o conjunto composto.
- **Manter o único pin completo inteiramente em JSONL**: elimina a duplicação pela suíte inteira, mas deixa as mudanças de prompt e de schema como uma única linha escapada. Markdown e JSON estruturado dão a cada superfície seu formato natural de revisão sem enfraquecer a asserção do cabeçalho reconstruído.
- **Enxugar o próprio log da sessão (registrar um digest do conteúdo, armazenar o cabeçalho em outro lugar)**: viola o contrato de reconstrutibilidade, pois o log do produto precisa reproduzir cada requisição bit a bit ([Agent Note de requisições reconstruíveis](../architecture/2026-07-05-reconstructable-requests.md)). O volume do cabeçalho é uma preocupação de artefato de teste, resolvida na normalização de testes; o log ao vivo fica intocado.

## Verificação

A suíte faz replay de todos os cenários contra os pins divididos. A cobertura unitária exercita os scrubbers independentes e o completo, os dois formatos de sidecar de cabeçalho completo, a regeneração na gravação e no refresh, a extração normalizada de prompt/schema, a imposição de ponto fixo, a simetria de arquivos obrigatórios, a uniformidade do cabeçalho reconstruído e a rejeição pela contagem de cabeçalhos alterados.

## Consequências

Uma mudança no prompt de sistema produz um diff de Markdown orientado a linhas em um arquivo por classe de composição afetada; uma mudança na descrição de uma ferramenta produz um diff de JSON estruturado em um arquivo por classe; as fixtures comuns de comportamento permanecem intocadas. As fixtures de sessão exibem tokens no lugar do conteúdo omitido, e a guarda de uniformidade ao vivo torna cada pin dividido autoritativo para toda sessão de sua classe. Cada cenário de pin carrega dois sidecars gerados, canonicalizados quanto à nova linha.
