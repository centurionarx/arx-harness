# Suporte a plataformas

[English](platforms.md) | Português

arx Harness roda em Linux, macOS e Windows. O agent loop (ciclo do agent), a persistência de sessões, a resolução de plugins, as configurações, as credenciais e todas as ferramentas, exceto o shell, se comportam da mesma forma nos três. Esta página identifica as diferenças e aponta para o pacote responsável por cada contrato.

## Uma família de shell por host

O bundle base monta exatamente uma família de shell, escolhida pela plataforma: `bash-sandbox` e `tool-bash` em POSIX, `pwsh-sandbox` e `tool-pwsh` no Windows por padrão. A interface de permissões é idêntica nos dois casos: aplicam-se a mesma política de sandbox, o mesmo seletor de permissões, o mesmo serviço de aprovação e a mesma restrição de acesso de `ctx.fs` ([conjunto de entradas e procedimento para restaurar Bash](../../../packages/bundle/base/README.md)).

Um modelo trabalhando no Windows escreve, portanto, PowerShell por padrão. A família Bash também roda no Windows pelo Git Bash, encontrado nos locais conhecidos do Git for Windows, no `PATH` sem o stub WSL em `System32`, ou por um `bashPath` explícito; se a busca não encontrar o executável, o carregamento falha com erro. Assim, um host Windows que prefira componentes escritos para POSIX pode seguir o procedimento para restaurar Bash, preservando literalmente skills (habilidades) e hooks escritos como scripts de shell ([regras de resolução do Bash](../../../packages/shell/bash-local/README.md)).

`verify:windows-parity` verifica esse contrato: confirma as entradas win32 complementares do patch base, a execução multiplataforma dos comandos de pre-commit e das gates Windows, e a presença de uma variante pwsh para toda sintaxe de shell exclusiva de POSIX nos arquivos `SKILL.md` do produto ([gate](../../../scripts/verify-windows-parity.ts)).

O próprio PowerShell é localizado, em vez de obrigatório: primeiro um `pwshPath` explícito, depois o local de instalação do PowerShell 7, então o `PATH` e, por último, o Windows PowerShell 5.1 como alternativa legada ([regras de resolução e ressalvas](../../../packages/shell/pwsh-local/README.md)).

## O confinamento difere em alcance, não apenas em mecanismo

| Host | Backend | Restringe |
|---|---|---|
| Linux | `landlock-run`, ou bubblewrap | leituras e escritas |
| macOS | `sandbox-exec` | leituras e escritas |
| Windows | Token restrito por ACL, pela API Win32 | apenas escritas |

O backend Windows não precisa de um binário externo: chama `CreateRestrictedToken` diretamente. Ele abre mão do confinamento de leitura e da política de rede, que não fazem parte de um token com restrição de escrita, e da capacidade de um processo confinado capturar a saída de um subprocesso neto por pipe. Uma ferramenta que precisa capturar saída não pode rodar confinada ([limites completos](../../../packages/sandbox/sandbox-windows-acl/README.md)).

A primeira escrita confinada em um workspace propaga ACLs pela árvore inteira, uma vez por workspace por máquina. Em um workspace grande, esse primeiro comando é lento.

## O controle de processos é menos granular no Windows

Filhos POSIX rodam no próprio grupo de processos e recebem sinais como um grupo. O Windows encerra árvores por `taskkill /T /F` na medida do possível, entrega a interrupção como um evento CTRL_C para todo o console, rejeita `SIGTSTP` e `SIGHUP` como indisponíveis e informa encerramento forçado como código de saída 1 sem sinal ([contrato de encerramento e sinalização](../../../packages/subprocess/subprocess-local/README.md)).

Cancelar um comando demorado é a operação cotidiana afetada por isso.

## Durabilidade e resolução de plugins são equivalentes por primitivas diferentes

Os logs de sessão são publicados com `link()` e fsync do diretório pai em POSIX, e com uma renomeação write-through sem substituição no Windows, porque o Node não oferece fsync do diretório pai nessa plataforma ([contrato de materialização](../../../packages/session/session-persistence-jsonl/README.md)).

A resolução alternativa de módulos do perfil vincula cada pacote com uma junction no Windows, então a instalação e a execução não precisam de elevação nem de Developer Mode ([organização do perfil](../../../packages/boot/app-boot/README.md)).

## O que o Windows não verifica

A verificação de permissões do documento de credenciais não roda. Em POSIX, um `$ARX_HOME/.credentials.yaml` com qualquer bit de permissão de grupo ou de outros falha antes de ser interpretado, e o erro indica a correção com `chmod 600`. O Windows não tem esse modo de permissão para inspecionar, então a verificação é omitida, não simulada ([contrato de armazenamento de credenciais](../../../packages/credentials/credentials-local/README.md)).

Proteja o diretório do harness com a ACL da própria conta.
