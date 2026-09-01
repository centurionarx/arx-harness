# Regras de tradução

[English](translation-rules.md) | Português

Como traduzir entre os dois lados de um par de documentação neste repositório. Os dois idiomas têm autoridade igual ([README.md](README.pt-BR.md)): uma mudança é escrita em qualquer um dos idiomas, e esse lado é a fonte daquela atualização — estas regras regem a produção ou atualização do parâmetro. Elas valem para humanos e agentes igualmente. O trabalho de agente rotineiro traduz o conteúdo alterado diretamente em uma passada guiada pela terminologia; o fluxo estendido [.agents/skills/arx-translate-docs](../../.agents/skills/arx-translate-docs/SKILL.md) só roda quando o usuário o invoca explicitamente. Os níveis de regra seguem o uso do RFC 2119: **MUST / MUST NOT** bloqueiam na gate ou na revisão; **SHOULD** pede uma razão declarada para desviar; **MAY** é a critério.

## Fidelidade

- O parâmetro *MUST* dizer o que o lado autoral diz — sem comportamento, pré-requisitos, avisos, claims de versão ou exemplos adicionados, e nenhum deles removido. Se o par divergir em substância, nenhum idioma vence por padrão: corrija o lado errado e leve o outro junto na mesma mudança.
- O parâmetro *SHOULD* ler como redação técnica natural no próprio idioma, não glossa palavra a palavra. Traduza o significado, reestruture frases onde a gramática alvo pedir e mantenha o registro do autor — o que é conciso permanece conciso.
- Não traduza o intraduzível: se uma frase resiste a uma renderização natural porque depende de um idiom do idioma de origem, traduza a ideia, não o idiom.

## Voz

- O registro é calibrado por [style-samples.md](style-samples.md) — pares de ouro aprovados por humanos, um por gênero de documento. O parâmetro *MUST* corresponder ao lado no idioma alvo da amostra mais próxima; onde a voz dela e uma regra de voz de prosa divergirem, a amostra vence. Alvos em português usam português técnico brasileiro natural; alvos em inglês usam prosa de desenvolvedor profissional e concisa.
- Escreva como um autor técnico nativo reafirmando o conteúdo, não como um tradutor transpondo frases, preservando cada oração da fonte: nada adicionado, nada removido — fluência nunca justifica perder uma oração.
- Dê às frases um ator explícito quando o idioma alvo de outro modo o obscurecesse; em português, troque passivas vagas ou sujeitos abstratos pelo ator real (o sistema, a gate, a revisão).
- Prefira idioms consagrados do idioma alvo a calcos (falso positivo/falso negativo para false positive/negative); localize metáforas em vez de transplantá-las e desdobre cadeias de substantivos quando o idioma alvo exigir.
- Divida parágrafos longos por unidade semântica — uma ideia por parágrafo. Os limites de parágrafo *MAY* divergir da fonte; a assinatura estrutural não conta parágrafos.
- Ao traduzir para o português, substantivos de categoria usam português com anotação em inglês na primeira menção (manual prático (cookbook)); ao traduzir para o inglês, use o nome de categoria convencional em inglês. Referências literais a diretórios ou arquivos permanecem em inglês formatadas como código.

## Preservação de estrutura

A gate de pareamento verifica profundidades de cabeçalho, code fences, contagens de linhas e colunas de tabelas, tipos de lista, inícios de listas ordenadas, contagem de itens, locale de link e destinos semânticos. Preserve o resto da moldura manualmente; os arquivos pareados *MUST* corresponder um a um em:

- hierarquia de cabeçalhos (mesmos níveis, mesma ordem — o TEXTO de cabeçalho é traduzido);
- formato e numeração de listas;
- tabelas (mesmas colunas, mesma ordem de linhas; células de cabeçalho traduzidas segundo a terminologia);
- code fences — byte-idênticos, inclusive comentários; a assinatura de pareamento compara as info strings e os conteúdos deles, e blocos ` ```ts ` compilam sob `doc-typecheck`;
- spans de código inline (comandos, flags, config keys, caminhos de arquivos, nomes de eventos, nomes de API, números de versão) — verbatim, nunca traduzidos ou reformatados;
- links e âncoras: todo link relativo de documento *MUST* manter o mesmo destino semântico e o sufixo exato de query/fragmento. Quando o destino pertence ao corpus bilíngue ativo, o lado inglês usa seu caminho `.md` e o lado português usa seu caminho `.pt-BR.md`; um parâmetro ausente nesse corpus é um erro, enquanto destinos fora dele mantêm o caminho original. URLs externas, imagens e fragmentos puramente internos ficam inalterados. O switcher de idioma continua sendo a exceção explícita entre locales, e um README renderizado fora do GitHub *MAY* usar a URL canônica do repositório público para seu parâmetro exato, como documentado no [README.md](README.pt-BR.md). O TEXTO de link é traduzido.

As convenções de Markdown do repositório se aplicam aos arquivos `.pt-BR.md` sem mudanças: uma linha física por parágrafo (`verify-md-wrap`), links relativos resolvíveis (`verify-md-links`), exatamente um newline final.

## Terminologia

- [terminology.md](terminology.md) é a fonte da verdade nos dois sentidos. Antes de traduzir, carregue-a; cada termo listado *MUST* seguir sua linha e as proibições de "Do not translate as". Um alvo em português usa a coluna "Portuguese" e a anotação de "First occurrence"; um alvo em inglês usa a coluna "English" sem adicionar uma glosa em português.
- Para um alvo em português, um termo técnico não listado *MAY* usar uma renderização brasileira consagrada de documentações de vendors ou OSS pt-BR principais, citada no PR. Sem tal precedente, ele *MUST* permanecer em inglês e ser listado em termos pendentes com uma renderização sugerida.
- Para um alvo em inglês, use o termo técnico inglês consagrado. Se o termo da fonte não tem equivalente consagrado inequívoco, preserve-o com uma glosa explicativa curta e liste-o em termos pendentes. Nenhum dos sentidos pode inventar uma renderização inline; um termo decidido entra em [terminology.md](terminology.md) no mesmo PR ou num follow-up.

## Tipografia

Estas regras regem o lado em português; o lado em inglês segue as convenções normais de Markdown do repositório (`AGENTS.md` raiz). As convenções de português abaixo seguem o [Acordo Ortográfico da Língua Portuguesa](https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/decreto/d6.583.htm) vigente, alinhadas às práticas principais de documentação técnica em pt-BR:

- *MUST* escrever português do Brasil (pt-BR): prefira formas brasileiras às europeias (`usuário`, não `utilizador`), exceto quando a tabela de terminologia decidir de outro modo para um nome de produto fixo.
- *MUST* usar pontuação latina (half-width) na prosa em português. Português não usa formas de pontuação CJK, e nenhum espaço vem antes da pontuação de fim de oração.
- A prosa em português *SHOULD* preferir dois-pontos, pontos, vírgulas ou parênteses a travessões; mantenha o travessão apenas onde é a pontuação natural do idioma.
- Use dígitos e letras latinas half-width e mantenha os acentos da ortografia vigente (`ação`, `sequência`, `não`); o trema é obsoleto.
- Marcadores de ênfase Markdown não criam fronteira de palavra; uma palavra em português em negrito ou itálico mantém espaços simples comuns ao redor das palavras vizinhas.
- Nomes próprios mantêm a grafia canônica: GitHub, TypeScript, pnpm — nunca `github`/`Github`, salvo ao citar código.
- A segunda pessoa é `você` (ou um verbo imperativo puro), nunca `tu`.
- Marcadores de ênfase (`**negrito**`, `*itálico*`) permanecem nos mesmos spans da fonte; não os substitua por aspas ou outra decoração.

## Padrão de qualidade

- Um par está pronto quando um engenheiro bilíngue lendo qualquer um dos arquivos sozinho obtém tudo o que o leitor do outro obtém — mesmos fatos, mesmas ressalvas, mesmo tom — e nada extra.
- Rode `pnpm run verify-translation-pairing` e o restante do `doc-sync` para registros, switchers, profundidades de cabeçalho, code blocks, contagens de linhas e colunas de tabelas, tipos de lista, inícios de listas ordenadas, contagem de itens, links e regras de Markdown do repositório. A revisão humana é dona da ordem de listas e tabelas, numeração não canônica, código inline, ênfase, significado, terminologia e tom.

## Referências

Autoridades citadas por estas regras, para humanos e agentes que quiserem o raciocínio subjacente:

- [Acordo Ortográfico da Língua Portuguesa](https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/decreto/d6.583.htm) — o acordo ortográfico brasileiro vigente; acentos, hífens e grafias que este arquivo assume.
- [Microsoft Style Guides](https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides) — a família de baselines de localização de vendors, incluindo prática de terminologia e tom em português do Brasil.
- [Google developer documentation style guide](https://developers.google.com/style) — as convenções de registro (prosa direta e concisa, atores, segunda pessoa) que a seção Voz deste arquivo espelha.
- [MDN Web Docs (pt-BR)](https://developer.mozilla.org/pt-BR/) — um corpus técnico pt-BR em uso para renderizações consagradas de termos de plataforma web.