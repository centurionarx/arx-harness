# Agent Note: Skills de manutenção do staging pessoal

Status: implemented
Archived: 2026-08-10

[English](2026-07-23-personal-staging-maintenance-skills.md) | Português

## Problema

As customizações pessoais do dsh precisam de uma forma repetível de localizar o código-fonte instalado, isolar o trabalho de cada tarefa, serializar a integração e incorporar mudanças do upstream sem reescrever o checkout usado pelas sessões em execução. Instruções locais do usuário resolvem isso para uma instalação, mas não conseguem orientar outros usuários nem permanecer sincronizadas com o comportamento do instalador do repositório.

## Decisão

O repositório distribui [`dsh-customize`](../../../../skills/dsh-customize/SKILL.md), [`dsh-upgrade`](../../../../skills/dsh-upgrade/SKILL.md) e [`dsh-upstream-customization`](../../../../skills/dsh-upstream-customization/SKILL.md) a partir do seu diretório raiz `skills/`. As descrições delas nomeiam tanto a operação quanto os pedidos do usuário que a selecionam. A TUI entregue fornece esse diretório ao provedor local de skills na inicialização, abaixo das raizes de projeto e de usuário na prioridade de descoberta. Os workflows derivam o checkout ativo e o branch de staging a partir do launcher instalado, e não de um caminho ou nome de branch específico do usuário, acatam as instruções locais do repositório, exigem worktrees de tarefa e serializam as mutações do staging com o `.agents/merge.lock` já estabelecido do worktree de staging.

Antes do rebase, um upgrade inspeciona o log do Git e os intervalos de commits para identificar as mudanças que chegam do upstream, os commits pessoais, as duplicatas e os conflitos prováveis. Ele descarta as customizações já fornecidas pelo upstream; quando resta apenas um diff local de documentação para uma customização dessas, ele também descarta esse registro, a menos que acrescente um contrato atual, útil por si só e ausente no upstream. Cada tentativa usa um único timestamp UTC em formato básico para o seu clone irmão independente `dsh-staging-<timestamp>`, o branch local `dsh-upgrade/prepare-<timestamp>`, o novo branch `dsh-staging/<timestamp>`, as refs privadas de upstream e de recuperação e o backup do launcher. O nome do clone irmão não deriva do nome do diretório atual, e colisões falham em vez de receber sufixos improvisados. O workflow deriva a origem do processo DSH atual a partir do comando do processo e do ambiente de runtime, e não do diretório de trabalho do shell, e então trata o repositório e o checkout por trás do launcher instalado como imutáveis, exceto por manter o merge lock que já existe ali.

Depois da validação no clone independente, o workflow cria e verifica o branch de staging com timestamp e então move o launcher de forma atômica, uma única vez, do checkout de staging antigo e inalterado para o novo checkout de staging. O launcher nunca aponta para um checkout de preparação, de feature, de revisão, de publicação ou em estado detached. Uma falha antes da virada deixa o checkout instalado e o launcher inalterados; uma falha depois da virada restaura e verifica o backup do launcher. O checkout de staging antigo, o branch dele, a ref de recuperação e o backup do launcher continuam disponíveis até que um processo reiniciado prove que o DSH roda a partir do novo branch de staging e o usuário aprove explicitamente a limpeza do rollback.

`dsh-upstream-customization` é dona da publicação no upstream, de forma independente da manutenção local e dos upgrades. Ela recomenda correções de bugs, funcionalidades de plugin aditivas e sem conflito e melhorias visuais; mudanças intrusivas exigem primeiro a aprovação de quem mantém o projeto. Ao final de um upgrade, o agent (agente) classifica as customizações restantes, explica o valor delas para o upstream, recomenda se cada uma deve ser proposta e pergunta qual candidata nomeada o usuário quer levar ao upstream. Só essa seleção carrega o workflow de publicação; cada funcionalidade ainda exige aprovação explícita antes de um push ou de um PR (Pull Request) em rascunho. As mudanças aprovadas partem do `master` atual do upstream, sem commits pessoais não relacionados. Os PRs em rascunho de funcionalidades da TUI incluem, de preferência, uma captura de tela da aplicação montada, depois de removidos as credenciais e os dados pessoais. `dsh-customize` exige que o comportamento interativo da TUI seja exercitado em uma sessão dedicada do tmux antes da integração.

## Alternativas consideradas

**Manter os workflows no escopo do usuário.** Isso preserva a flexibilidade pessoal, mas impede que outros usuários descubram as mesmas regras de segurança e deixa o workflow se afastar do instalador entregue pelo repositório.

**Fazer o rebase do checkout de staging ativo no próprio lugar.** Isso é mais simples, mas altera muitos arquivos durante a preparação, pode atrapalhar novas inicializações do dsh e não consegue oferecer publicação atômica nem um checkout de rollback inalterado.

**Atualizar o checkout de staging existente depois de mover o launcher para outro lugar.** Isso mantém um único caminho de staging, mas exige, no meio do upgrade, um alvo de launcher que não é um branch de staging e ainda reescreve um checkout que pode hospedar um processo em execução.

**Travar apenas a troca final de branch.** Isso encurta a duração do lock, mas permite um merge de customização contra a base antiga enquanto o rebase está sendo preparado, invalidando o histórico preparado.

**Abrir um único PR no upstream para todas as mudanças pessoais.** Isso reduz o gerenciamento de branches, mas publica customizações não relacionadas e elimina a fronteira de aprovação por funcionalidade do usuário.

## Consequências

A preparação do upgrade mantém o merge lock do staging instalado enquanto as dependências e as verificações rodam, de modo que a integração de customizações locais espera um resultado consistente. Um upgrade cria um clone independente e um branch de staging com timestamp, executa uma única virada atômica do launcher e exige uma reinicialização depois; ele nunca grava no repositório ou no checkout por trás do launcher, exceto para manter o lock que já existe ali. Cada workflow registra as pré-condições, repete-as antes da mutação, inspeciona o estado depois de mutações interrompidas, restaura o backup do launcher em caso de falha na virada, roda de novo as verificações que falharam depois da correção e informa o estado final. O checkout de staging antigo continua servindo de armazenamento de rollback até a limpeza aprovada explicitamente pelo usuário. As avaliações versionadas cobrem a seleção, a proteção da origem do processo, os estados inseguros do repositório, o rollback e a autorização de publicação; as verificações de documentação do repositório validam os links e a formatação das skills, enquanto a revisão técnica continua responsável pela correção em relação ao Git e ao sistema de arquivos.
