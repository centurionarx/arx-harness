# Agent Note: Gate de completude de JSDoc para a superfície do cordis

Status: implemented
Archived: 2026-07-27

[English](2026-07-04-cordis-jsdoc-completeness-gate.md) | Português

## Problema

O catálogo gerado do Cordis impunha os modos de despacho dos eventos, mas não contratos completos de serviço e de evento. Métodos podiam ficar sem descrição, e parâmetros ou retornos podiam ficar sem documentação justamente na superfície de API entre plugins, onde a orientação da IDE mais importa.

A regra do AGENTS.md ("every export has a JSDoc explaining semantics") só pode ser verificada em prosa pela revisão; a preferência declarada do repositório é codificar invariantes em gates mecânicas. O escopo "funções de serviço e eventos do cordis" tem uma definição precisa de máquina que só o gerador do catálogo conhece: os eventos são os membros de `interface Events` dentro de `declare module 'cordis'`, e a superfície de serviço são os métodos públicos da classe que cada chave de `interface Context` nomeia. Uma regra do ESLint não enxerga esse mapeamento; o gerador o calcula a cada execução.

## Decisão

Estender `scripts/gen-cordis-catalog.ts`, com a mesma travessia e o mesmo precedente do `@mode`, para impor a COMPLETUDE de JSDoc em tudo o que ele cataloga. `verify-cordis-catalog` roda dentro do `doc-sync` (gate de sincronização da documentação), então as mudanças de documentação relevantes e a CI exercitam a mesma gate sem ligação à parte.

O contrato:

- **Eventos** precisam de prosa de descrição mais um `@param` não vazio para cada **parâmetro de payload**. Um parâmetro de payload é um parâmetro da assinatura que carrega dados do evento; a anotação do receptor `this` e o `next` final do waterfall (evento em cascata) estão isentos: `next` é maquinaria de despacho cuja semântica já pertence à tag `@mode waterfall` (e à sua verificação cruzada estrutural), então repeti-la a cada evento seria boilerplate. Documentar mesmo assim um parâmetro isento é permitido; só a ausência é verificada.
- **Classes de serviço** precisam de JSDoc no nível da classe, e todo método público precisa de prosa de descrição, de um `@param` não vazio por parâmetro e de um `@returns` não vazio, a menos que o tipo de retorno anotado seja `void`/`Promise<void>` (caso em que `@returns` continua opcional, já que o momento da resolução pode valer a documentação, mas nunca é exigido).
- **Tags desatualizadas dão erro**: um `@param` que não nomeia nenhum parâmetro real é uma violação, espelhando a verificação de `@mode` que contradiz a assinatura. As descrições das tags precisam ser não vazias; a qualidade semântica delas além disso é trabalho da revisão.
- **Explicitude que a travessia consegue verificar**: a gate é uma passagem puramente sobre a AST (sem verificador de tipos), então um método de serviço precisa anotar seu tipo de retorno (um retorno inferido não pode ser classificado) e os parâmetros da superfície precisam ser identificadores simples (um padrão de binding não tem nome com que o `@param` possa casar).
- **As violações são agregadas** em um único erro que lista todos os infratores: uma passada de correção vê a lista inteira de uma vez. As verificações de `@mode`, antes fail-fast, passaram para o mesmo relatório agregado, com os textos das mensagens inalterados.

O gerador mantém duas visões do mesmo comentário do código-fonte: `parseJsDoc` encerra a prosa da entrada na primeira tag de bloco, enquanto o bloco de assinatura `ts cordis-catalog` inclui o JSDoc original com `@param`, `@returns` e `@mode` intactos. Assim, o leitor vê o contrato completo do código-fonte sem que o texto das tags de bloco vaze para a prosa ao redor.

Os testes de caminho negativo em `packages/core/agent/tests/gen-cordis-catalog.spec.ts` acionam `collectEvents`/`collectServices` contra fixtures (dados de teste pré-montados) sintéticas para provar que cada guarda dispara e que as isenções valem. A regra de autoria vive no item de convenções do [AGENTS.md](../../../../AGENTS.md) raiz, ao lado da regra do `@mode`.

## Alternativas consideradas

- **Uma regra do ESLint**: não enxerga a definição de máquina do escopo (quais membros de `interface Events` e quais classes de `ctx.<key>` são a superfície do cordis); o gerador do catálogo calcula exatamente esse mapeamento a cada execução, então a gate vive ali.
- **Expandir cada método em uma seção de prosa separada**: rejeitada. O catálogo continua fácil de percorrer ao manter uma seção por serviço e um bloco de assinatura, enquanto o JSDoc anexado a cada declaração preserva no próprio lugar o contrato completo do método.
- **Uma tag de escape**: não existe nenhuma; a superfície é pequena e curada (12 serviços, 57 métodos e 27 eventos na adoção), e o ponto é justamente que a verificação não pode ser dispensada.

## Consequências

- Um novo evento ou método de serviço não pode entrar com um parâmetro ou um resultado sem documentação: o gerador se recusa a regenerar, e `verify-cordis-catalog` faz falhar o `doc-sync` e a CI. As ~139 lacunas encontradas na adoção foram preenchidas na mesma mudança, então a gate entrou verde.
- A superfície de serviço precisa anotar os tipos de retorno explicitamente e usar parâmetros identificadores. Nenhuma das duas restrições pesou na adoção (todos os métodos já estavam anotados; não existiam parâmetros de seam desestruturados); as duas agora são requisitos de que o repositório depende e que uma mudança infratora descobre de forma mecânica.
- A regra geral de JSDoc do AGENTS.md ("one-liners when one line suffices") ganha uma exceção mais estrita nesta superfície: um resumo de uma linha só continua bastando quando o método não tem parâmetros e tem resultado void.
- `@param` em `next` ou em `this` continua permitido, mas não é verificado. É uma assimetria deliberada: a gate impõe o contrato de payload e se recusa a exigir boilerplate.
- Cada fragmento gerado de evento ou de método carrega o seu JSDoc original, enquanto o resumo em prosa permanece sem tags. Assim, as edições no código-fonte atualizam tanto o índice legível quanto o contrato exato mostrado ao lado da assinatura.
