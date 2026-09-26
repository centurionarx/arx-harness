# Acesso e segurança

[English](security.md) | Português

A Web UI controla um agent (agente) que pode ler arquivos, executar ferramentas e usar as credenciais disponíveis ao processo host. Trate o acesso a essa UI como acesso ao ambiente de operação do agent, não como um painel somente leitura.

## Acesso local

O perfil Web escuta em `127.0.0.1:3080` por padrão. Mantenha esse endereço de loopback para uso pessoal; não encaminhe sua porta em um roteador nem a publique de um container para uma rede não confiável. Outros processos e usuários com acesso ao mesmo host ainda podem alcançar o loopback, então execute o harness com uma conta de sistema operacional em que você confie.

O [servidor HTTP](../../../packages/host/webserver/README.md#known-limitations-and-deferred-work) não oferece autenticação, TLS nem política de origem integrados. Mudar o endereço de escuta para `0.0.0.0` permite que clientes de rede alcancem essas rotas sem autenticação. Uma seleção de workspace ou um diálogo de aprovação não autentica um cliente de navegador.

<a id="remote-access-through-ssh"></a>

## Acesso remoto por SSH

Para um host remoto pessoal, mantenha o harness escutando no loopback e use um túnel SSH autenticado em vez de expor a porta Web. Inicie o harness no host remoto com `arx web --no-open` e execute este comando na sua máquina, substituindo `user@host` pelo destino SSH:

```sh
ssh -N -L 127.0.0.1:13080:127.0.0.1:3080 user@host
```

Abra `http://127.0.0.1:13080` localmente. A escuta local do túnel também fica restrita ao loopback; encerre o processo SSH quando não precisar mais do acesso. Se o harness remoto usar outra porta, substitua o último `3080` por ela.

Um login do Codex pelo navegador, feito pelo cartão **Native product accounts** ou pelo cartão **OpenAI Codex chat models** da página Models, retorna para `http://localhost:1455/auth/callback`, e o processo que faz o login atende esse endereço no host remoto. Encaminhe a porta 1455 no mesmo túnel antes de iniciar um desses logins e mantenha essa porta livre na sua máquina:

```sh
ssh -N -L 127.0.0.1:13080:127.0.0.1:3080 -L 1455:127.0.0.1:1455 user@host
```

O segundo encaminhamento não indica endereço local, então escuta em todos os endereços de loopback para os quais `localhost` pode resolver no seu navegador. O host remoto atende um retorno desses por vez. O login do Codex por código de dispositivo e o login do Claude Code, que recebe um código colado, dispensam o encaminhamento.

## Requisitos de deploy em rede

Um deploy que não possa usar um túnel precisa de uma camada de acesso operada separadamente. Antes de torná-lo acessível a outras máquinas:

- Exija acesso autenticado e autorizado a toda rota HTTP e conexão com upgrade, não apenas à página HTML.
- Termine TLS e aplique a política de origem de navegador desejada nessa camada de acesso.
- Mantenha a porta do backend inacessível fora da camada de acesso confiável; proteger uma URL pública não protege uma segunda rota direta ao backend.
- Verifique que requisições sem autenticação e origens não permitidas sejam rejeitadas, incluindo upgrades WebSocket, downloads e requisições de API.
- Use uma identidade de sistema operacional dedicada e estado e credenciais separados para usuários que não devam compartilhar autoridade. O processo Web compartilhado não é uma fronteira de isolamento entre tenants.

Esses controles são responsabilidades do deploy, não funcionalidades ativadas por uma configuração do harness. Não exponha o servidor diretamente antes de configurá-los e testá-los.

## Permissões de ferramentas e credenciais

Escolha a política de sistema de arquivos mais restrita que permita a tarefa, revise as mudanças de permissão solicitadas e instale somente plugins e predefinições confiáveis. Os [modos de sandbox](../../../packages/sandbox/sandbox/README.md#known-limitations-and-deferred-work) descrevem efeitos sobre arquivos; não prometem isolamento de rede nem de credenciais. Use um ambiente isolado de forma independente quando essas restrições forem necessárias.

Armazene credenciais pelo provedor de credenciais configurado, em vez de em prompts ou arquivos do repositório. Proteja o diretório do harness e seus backups com controles de acesso do sistema operacional. Ocultar campos secretos nas respostas de configurações não impede que um plugin confiável ou uma ferramenta autorizada use credenciais disponíveis ao processo.
