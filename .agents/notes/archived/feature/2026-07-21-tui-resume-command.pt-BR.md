# Agent Note: Retomada de sessão da TUI em nível de produto

Status: implemented
Archived: 2026-08-04

[English](2026-07-21-tui-resume-command.md) | Português

## Problema

O `/resume` original imprimia comandos de shell. Ele não permitia que um usuário de teclado inspecionasse títulos ou resultados, distinguisse corrupção de um adaptador ausente, nem transferisse o terminal com segurança. Sair da TUI e lançar um comando manualmente também escondia a ordem exigida: terminar o trabalho atual, fazer o flush dele, liberar a UI e o app e então restaurar a identidade persistida exata, sem criar uma substituta em silêncio.

## Decisão

`/resume` usa o seam de overlay interativo que a TUI já tem como um seletor de viewport inteira, e não como um diálogo centralizado. A página plana mantém o campo de busca, a linha de escopo de workspace, os candidatos e o rodapé de atalhos em regiões estáveis da tela; só a linha ativa usa o papel accent. O editor de busca começa imediatamente depois do glifo de busca e emite o marcador de cursor do pi-tui, de modo que a composição por IME do terminal permanece ancorada no campo. Escape limpa uma consulta não vazia antes que um segundo Escape feche o seletor. Ele ordena os candidatos pela última atividade registrada no log e busca pelo título ou pelo id sustentados pelo log. Cada candidato exibe o estado atual/vivo/persistido, o resultado do último turno, o provedor/modelo recente, a fase durável do goal quando presente e o id como texto secundário. A sessão atual e as sessões já vivas neste runtime permanecem visíveis, mas desabilitadas. O seletor abre no workspace atual e alcança todos os outros pela alternância de escopo, cuja dona é a nota de [retomada entre workspaces](2026-07-28-cross-workspace-resume.md).

`session-query.readSession()` fornece um log completo e desanexado, validado pela mesma fronteira de replay do core usada pela retomada. A TUI deriva o título e o estado do goal a partir desse log. Uma falha ao carregar um candidato é local àquela linha; selecionar um candidato revalida o log, o workspace, a rota, o status ocioso do agent (agente) atual e as exclusões da sessão atual e das sessões já vivas neste runtime, de modo que uma listagem desatualizada não consegue contornar o preflight. Um adaptador ausente é informado como uma sessão íntegra com uma rota indisponível. Esse preflight não bloqueia o alvo nem exclui outro processo.

Depois do preflight, a TUI faz o flush da sessão atual, confirma que o agent dela continua ocioso e então para o terminal antes de chamar `TuiRuntime.handoffResume` com o id validado e o workspace de destino. O host `dsh` distribuído faz o dispose (liberação de recursos) do app raiz e usa `process.execve` com um argumento `--resume` normalizado, substituindo o processo de forma atômica em vez de iniciar um filho. O app retomado publica o mesmo `SessionId`; o replay comum restaura o transcript (registro textual da sessão), o título, os todos e o estado durável do goal. A ativação do goal é intencionalmente desarmada, e a TUI pede confirmação humana ou `/goal resume`.

A linha de saída é um slot de contexto que pertence ao launcher, e não um template de configuração, e um host sem handoff no próprio processo informa que a sessão continua retomável em vez de nomear um comando que ele não consegue construir; a nota de [identidade de retomada pertencente ao launcher](../architecture/2026-07-28-launcher-owned-resume-identity.md) é a dona dessa mudança de propriedade e substitui a chave de configuração `resumeCommand` que esta nota entregou originalmente. A TUI continua sem nunca executar texto de shell.

## Alternativas consideradas

**Fazer a TUI fazer spawn do comando de retomada.** Rejeitada: o texto é copy de exibição, não argv confiável, e a TUI não é dona do teardown do app nem do tempo de vida do processo. O seam restrito do host recebe apenas um `SessionId` validado.

**Construir o agent retomado dentro da TUI existente.** Rejeitada: substituir um agent criado pela configuração atravessaria, na camada de apresentação, a propriedade do Loader, a configuração de plugins com escopo, a aposentadoria da persistência e o ciclo de vida do terminal. O dispose da raiz mais a substituição do processo reutiliza o caminho de inicialização suportado.

**Tratar um adaptador ausente como uma sessão ausente.** Rejeitada: a validade do armazenamento e a disponibilidade atual da rota são fatos independentes. O seletor mantém a linha e nomeia o provedor/modelo indisponível.

**Persistir a ativação do goal através da retomada.** Rejeitada: uma intenção durável não é autorização para continuar depois de uma fronteira humana ou de processo. A fase do goal sobrevive; a continuação automática, não.

## Consequências

- Processos concorrentes podem selecionar ou retomar a mesma sessão persistida, porque o preflight não os serializa.
- `/resume` depende de `session-query` para a descoberta e para as leituras do log completo, mas a persistência e o handoff do host continuam opcionais; sem um host, o fallback do comando continua utilizável.
- A substituição do processo reinicia intencionalmente a composição do Loader. O estado que existe só no runtime é reconstruído, enquanto só sobrevive o estado de sessão registrado no log ou sustentado pelo cabeçalho.

## Testes

Os testes do pacote da TUI cobrem a navegação por teclado, a busca por título/id, o comportamento de limpar a busca/cancelar, a recusa com agent em execução, a recusa da sessão atual e das sessões já vivas neste runtime, a ausência de rota, as linhas corrompidas, a revalidação do preflight, o aviso de ausência de host e a ordem de parar antes do handoff. Os testes do session-query fixam a validação desanexada do log completo. Os testes de retomada do agent-loop fixam a identidade e o histórico exatos; as suítes de replay de título, todo e goal fixam as projeções restauradas e a ativação desarmada do goal. O snapshot semântico do pacote é dono do seletor de viewport inteira e da âncora de cursor do IME dele; uma implantação que distribui a TUI é dona da aceitação do handoff de processo e de PTY dela.
