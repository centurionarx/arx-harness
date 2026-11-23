# Agent Note: as linhas de contexto do diff na TUI ficam neutras

Status: implemented
Archived: 2026-08-04

[English](2026-07-31-tui-diff-context-line-accounting.md) | Português

## Problema

Os diffs de sistema de arquivos produzidos no momento do resultado trazem a mudança aplicada com três linhas de contexto ao redor em cada `FileDiff.oldText` e `FileDiff.newText`. A TUI renderizava toda linha do lado antigo como removida e toda linha do lado novo como adicionada, inclusive o contexto idêntico presente nos dois lados. Uma edição de uma linha aparecia, portanto, como sete remoções mais sete adições, e o rodapé repetia esses totais inflados.

## Decisão

A TUI compara cada `FileDiff` cujos textos antigo e novo estejam ambos disponíveis. As linhas adicionadas e removidas mantêm seus marcadores `+` verde e `-` vermelho; as linhas de contexto iguais usam o tom recuado do corpo, com um prefixo neutro de dois espaços. O rodapé soma apenas as linhas classificadas como adicionadas ou removidas. `maxDiffEditLength` limita a comparação exata pela contagem combinada de linhas adicionadas e removidas; o padrão é 1000. Ultrapassar o limite renderiza o lado antigo completo como removido e o lado novo completo como adicionado, marca o rodapé como aproximado e guarda esse resultado em cache, para que os redesenhos não repitam a comparação. Um resultado da ferramenta limpa o cache da visão pendente antes de derivar a visão definitiva, inclusive quando um presenter altera e reutiliza o mesmo objeto de visão.

Quando `oldText` é `null`, o renderizador não consegue distinguir uma criação de uma sobrescrita pendente ou de um fallback de argumento cujo texto anterior não está disponível. Por isso ele mostra toda linha não vazia do lado novo como adicionada, sem afirmar que essas linhas estavam ausentes de um arquivo existente. Conteúdo novo vazio não renderiza nenhuma linha adicionada sintética.

Isso continua sendo uma interpretação, do lado do consumidor, do contrato existente de `FileDiff`. As ferramentas de sistema de arquivos continuam persistindo trechos contextuais de antes/depois, então os outros consumidores mantêm seu contexto de posicionamento e os logs de sessão existentes fazem replay com a apresentação corrigida na TUI. A TUI usa o mesmo pacote `diff`, mantido, que o `dsh-tool-fs` usa, em vez de introduzir uma segunda implementação de diff de linhas.

## Alternativas consideradas

**Remover o contexto dos metadados de resultado do sistema de arquivos.** Rejeitada: os hunks aplicados com contexto são saída intencional do produtor, usada por editores capazes, e mudá-los enfraqueceria todos os consumidores e ainda deixaria os logs de sessão antigos enganosos na TUI.

**Estender `FileDiff` com tags persistidas por linha.** Rejeitada: as tags podem ser derivadas de forma determinística a partir do par antes/depois existente; persisti-las ampliaria o contrato entre pacotes e o do log de sessão apenas por causa de um renderizador.

**Casar linhas iguais por posição, sem um algoritmo de diff.** Rejeitada: inserções e remoções deslocam o contexto seguinte, então o pareamento posicional classificaria errado hunks válidos.

**Executar toda comparação até o fim.** Rejeitada: as visões pendentes de ferramenta podem conter strings antigas e novas irrestritas, escritas pelo modelo, e uma comparação de Myers sem limite pode bloquear o renderizador síncrono do terminal.

## Consequências

Os cartões de diff da TUI distinguem o contexto que serve de evidência da mutação em si, e um rodapé exato `+A -R` informa o delta real de linhas. Fazer replay de um diff contextual existente ganha a renderização corrigida sem migração. Os hunks de sistema de arquivos do momento do resultado são limitados pelo contexto; as visões pendentes irrestritas ou terminam dentro do orçamento configurado de tamanho de edição ou degradam para uma renderização linear explicitamente aproximada.

Os testes focados da TUI cobrem contexto neutro, totais exatos, uma criação vazia, o fallback limitado, a invalidação do cache no momento do resultado e a reutilização do cache no redesenho. Os snapshots de terminal `advanced-cards`, da aplicação montada, fixam o estilo neutro de contexto, as cores semânticas de mudança, o rodapé exato e o fallback aproximado nos estados recolhido e expandido do cartão.
