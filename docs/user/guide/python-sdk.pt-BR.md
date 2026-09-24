# Primeiros passos com o SDK Python

[English](python-sdk.md) | Português

Este tutorial é a alternativa programática à Web UI. Ele instala o SDK Python publicado, executa uma composição de agent (agente) versionada no repositório e mostra como chamar a mesma API no seu programa.

## Pré-requisitos

- Python 3.10 ou mais recente
- Git
- Linux x64, Linux arm64, Windows 10 ou mais recente em x64, ou macOS 14 ou mais recente em arm64
- Um endpoint de API de modelo compatível com OpenAI e uma credencial
- Um workspace isolado que o agent possa modificar

## Instalar o SDK

Clone o repositório para obter o exemplo executável, crie um ambiente virtual e instale o SDK com seu runtime incluído da mesma versão:

```sh
git clone https://github.com/centurionarx/arx-harness.git
cd arx-harness
python -m venv .venv
. .venv/bin/activate
python -m pip install arx-harness-sdk
```

O runtime instalado não precisa de um Node.js no sistema. Quem contribui com o repositório e precisa construir o runtime ou pacotes wheel a partir do código-fonte deve usar os [workflows de contribuição Python](../../../python/development.md).

## Executar o exemplo do repositório

Defina a credencial no ambiente. Defina também `DEEPSEEK_BASE_URL` quando um proxy compatível com OpenAI servir o modelo, em vez do endpoint padrão da rota.

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
# export DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
# export ARX_MODEL=deepseek-v4-flash
# export ARX_SYSTEM_PROMPT='You are a helpful software engineer assistant.'
```

Execute uma tarefa em um workspace e um diretório de sessões isolados:

```sh
python examples/jsonrpc-agent/minimal.py \
  --workspace /absolute/path/to/workspace \
  --session-root /absolute/path/to/sessions \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

O script imprime a resposta final do assistente. O diretório de sessões recebe um log JSONL com as requisições de modelo montadas e as chamadas de ferramentas.

## Usar o SDK no seu programa

O exemplo do repositório é um wrapper simples desta chamada ao SDK:

```python
from pathlib import Path

from arx_harness import ArxHarness

config = Path("examples/jsonrpc-agent/minimal.cordis.yml").resolve()
workspace = Path("/absolute/path/to/workspace").resolve()
sessions = Path("/absolute/path/to/sessions").resolve()

with ArxHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    session_root=str(sessions),
    cordis=str(config),
) as harness:
    result = harness.run(
        "Inspect the repository and fix the failing tests.",
        session_id="example-001",
    )

print(result.final_response)
```

`ArxHarness` inicia o runtime incluído sob demanda e o reutiliza até a saída do gerenciador de contexto. Reutilizar o mesmo harness e id de sessão preserva o processo Bash da sessão, incluindo o diretório de trabalho, as variáveis exportadas e as funções de shell. Use um novo id de sessão para uma tarefa independente; reutilize um id somente quando a próxima chamada deva continuar a mesma conversa durável.

## Entender a composição do exemplo

| Propriedade | Valor |
|---|---|
| Prompt de sistema | `ARX_SYSTEM_PROMPT`, com fallback para `You are a helpful software engineer assistant.` |
| Modelo em `minimal.py` | `--model`, depois `ARX_MODEL`, depois `deepseek-v4-flash` |
| Ferramentas expostas ao modelo | Somente `bash` persistente e `str_replace_editor` |
| Timeout do Bash | 300 segundos |
| Limite de saída do editor | 16.000 caracteres |
| Compactação de contexto | Desativada |
| Sistema de arquivos | Backend local sem restrição; caminhos absolutos do editor podem apontar para qualquer caminho visível ao processo do runtime |
| Persistência de sessões | JSONL sem compressão em `ARX_SESSION_ROOT` |

A composição omite a identidade do harness, o texto de workspace no prompt, skills (habilidades), Bash de execução única, ferramentas de tarefa, compactação (compaction) e todos os outros plugins expostos ao modelo. Os fatos da política de sandbox são registrados como contexto de usuário do runtime, em vez de acrescentados ao prompt de sistema.

## Escolher workspace e IDs de sessão

`cwd` seleciona o workspace disponível ao agent, enquanto `session_root` armazena os logs e o estado das sessões. Use um novo id de sessão para uma tarefa independente; reutilize um id somente quando a próxima chamada deva continuar a mesma conversa e o estado persistente do shell.

A composição usa `danger-full-access`. Execute-a apenas em um checkout descartável ou container: Bash e o editor podem modificar qualquer caminho permitido ao processo do runtime. O backend PTY persistente exige um terminal POSIX, então essa composição não suporta agents Windows.

A [referência do exemplo `jsonrpc-agent`](../../../examples/jsonrpc-agent/README.md) define a composição exata. A [referência do SDK Python](../../../python/sdk/README.md) cobre ciclo de vida, resultados, notificações, seleção de runtime e configuração; a [introdução ao Cordis](../../cordis-primer.md) cobre a sintaxe de composição.
