# @arx-ai/arx-session-turn-outline

[English](README.md) | Português

Índice opcional de turnos da sessão inteira, servido pelo registro de projeções da sessão. Acumula o log durável completo na projeção `turnOutline`, incluindo o histórico herdado em forks. Cada entrada mantém o número do turno, a sequência exata de `turn/start`, a sequência final opcional, uma prévia do primeiro texto direto do usuário e o motivo registrado de encerramento. Turnos abertos informam `running`.

A prévia normaliza espaços em branco e mantém no máximo 120 pontos de código Unicode. Orientações posteriores do usuário e mensagens de plugins não substituem a primeira prévia não vazia. Turnos sem texto continuam endereçáveis com prévia vazia. O índice mantém uma entrada por turno em blocos imutáveis de até 256 entradas. Cada atualização copia apenas o bloco mais recente e compartilha os anteriores, evitando copiar o índice completo a cada evento durante o replay. Não há truncamento ou configuração; seu armazenamento cresce com a quantidade de turnos. Compactar o contexto do modelo ou paginar o histórico do navegador não descarta o log de origem nem o índice.

O registro é responsável pelo replay, pela persistência opcional do cache, pela validação do schema e pela entrega ao cliente. As atualizações transportam no máximo 100 turnos recentes, a quantidade total e um cursor para a página anterior. O Remote autenticado `turnOutlines.page(sessionId, before, query)` pesquisa o índice completo no host e retorna no máximo 100 resultados; a busca aceita até 200 caracteres. Descarregar este plugin remove sua chave de projeção. A [UI do índice](../../client/ui-turn-outline/README.md) fornece busca e navegação.

## Experiência do modelo

Nenhum efeito, pois a projeção deriva apenas dados de visualização dos eventos existentes da sessão.

#### Efeito no KV Cache

Nenhum; o pacote não altera requisições ao modelo nem seus prefixos de tokens.

## Limitações conhecidas e trabalho adiado

- A prévia é um trecho da entrada do usuário, não um resumo gerado pelo modelo nem prova de execução bem-sucedida da tarefa. O motivo de encerramento registra o resultado do ciclo. O índice completo no host e seu checkpoint opcional crescem com a quantidade de turnos; as atualizações no navegador permanecem limitadas.
