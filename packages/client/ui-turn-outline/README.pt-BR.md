# @arx-ai/arx-client-ui-turn-outline

[English](README.md) | Português

Contribuição opcional para `conversation.view` que mostra o [índice de turnos da sessão inteira](../../session/session-turn-outline/README.md). A aba Turn outline exibe a prévia do primeiro texto do usuário e o resultado registrado de cada turno, incluindo turnos antigos cujas linhas da conversa não estão carregadas. A busca consulta o índice completo no host por páginas Remote autenticadas. Cada resposta e lista renderizada contém no máximo 100 turnos; Older turns substitui a página e Newest turns retorna aos resultados mais recentes. Uma projeção indisponível é indicada explicitamente; a UI não reconstrói um índice parcial a partir da janela carregada.

Selecionar um turno solicita ao proprietário da conversa a abertura de sua sequência inicial exata. O proprietário carrega no máximo 20 páginas de histórico em série, para se uma página falhar ou não avançar e ativa Chat somente após resolver uma linha visível dentro daquele turno. Chat aplica e limpa um alvo de linha de uso único, preservando a posição resultante entre trocas de abas. Sair do índice ou trocar de sessão invalida a navegação pendente; uma requisição de histórico já despachada pode terminar. Uma navegação recusada exibe uma explicação que permite nova tentativa. Turnos sem linha visível no chat não podem ser abertos.

Este plugin não possui armazenamento de dados de negócio, evento do host, acesso ao sistema de arquivos nem entrada visível ao modelo. Usa o espaço existente de visualização, o hook padrão de projeção e o registro de textos localizados.

## Experiência do modelo

Nenhum efeito, pois o plugin apenas pagina e renderiza o índice de turnos derivado do replay.

#### Efeito no KV Cache

Nenhum; o pacote não altera requisições ao modelo nem seus prefixos de tokens.

## Limitações conhecidas e trabalho adiado

- A navegação pode exigir várias tentativas para um histórico a mais de 20 páginas de distância. O host mantém o índice completo derivado do replay; o navegador mantém uma página limitada. O resultado do turno é o motivo registrado pelo ciclo e não avalia se o trabalho solicitado estava correto.
