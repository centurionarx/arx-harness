# Agent Note: A resolução do contexto do modelo na TUI adia diante da corrida de registro de adaptadores

Status: implemented
Archived: 2026-08-04

[English](2026-07-30-tui-adapter-registration-race.md) | Português

## Problema

O Cordis ativa plugins pela disponibilidade de serviços, não pela ordem da configuração, então a TUI (cujo `inject` exige apenas o serviço `llm`) pode ser montada antes que um plugin de adaptador configurado, como `dsh-llm-pi-ai`, termine de registrar as rotas de provedor dele. O controlador de modelo da TUI resolve a janela de contexto do modelo selecionado imediatamente na montagem; quando a rota do agent (agente) apontava para um provedor ainda não registrado, `resolveModelInfo` rejeitava com `NO_ADAPTER` e toda sessão nova imprimia `Could not resolve model context: no adapter registered for provider "…"`, um erro espúrio para uma configuração que funcionava plenamente (o adaptador era registrado milissegundos depois, e a conversa funcionava).

## Decisão

O controlador de modelo da TUI trata uma rejeição `NO_ADAPTER` da resolução da janela de contexto como um estado transitório, e não como um erro: ele estaciona a resolução em silêncio e resolve de novo no próximo commit de `llm/adapters-updated`, a notificação de registry sem payload que o `LlmService` já dispara em todo ponto de commit de rota. Um commit que ainda não traz a rota estaciona a espera de novo, então mudanças de topologia não relacionadas continuam silenciosas. Qualquer mudança de alvo reentra na resolução e limpa a espera pendente, então o estado adiado nunca fica desatualizado em relação à seleção atual; todo outro erro de resolução ainda imprime o aviso.

## Alternativas consideradas

**Fazer a TUI esperar o boot se estabilizar antes de resolver.** A TUI não tem dependência do Loader (testes e embedders rodam sem ele) e "estabilizado" não é observável de dentro de um plugin; adicionar um acoplamento ao Loader por causa de uma resolução cosmética inverte a direção da dependência.

**Fazer polling ou tentar de novo com um timer.** Um timer chuta a latência de ativação, ainda imprime o erro indevidamente com um adaptador lento e adiciona um parâmetro ajustável sem dono. O registry já anuncia todo commit por `llm/adapters-updated`; assinar esse evento é preciso e não custa nada.

**Ordenar a configuração para que os adaptadores carreguem primeiro.** A ordem das linhas não carrega semântica de carga no Loader (a ativação é guiada por serviços por design), então isso não pode ser expresso na configuração.

**Suprimir totalmente os erros NO_ADAPTER.** Um adaptador permanentemente ausente (erro de digitação no nome do provedor) nunca apareceria no caminho da janela de contexto. Adiar preserva o sinal: um nome de provedor errado ainda mostra um comportamento do tipo `model unset` no seletor e falha de forma ruidosa no dispatch, enquanto a corrida de inicialização se resolve sozinha.

**Resolver a janela de contexto a cada mensagem enviada, em vez de na montagem.** O caminho de envio já resolve por etapa (`prepareCall()`), e o indicador é exibido continuamente, não só durante o envio; resolver para exibição a cada envio deixaria o indicador em branco até a primeira mensagem e repetiria o I/O do adaptador para um valor que só muda quando as rotas mudam.

## Consequências

Um provedor genuinamente mal configurado não imprime mais o erro de resolução de contexto na inicialização: ele aparece no primeiro dispatch, que é onde a falha é acionável. O controlador assina todo commit de `llm/adapters-updated`, mas só age enquanto uma espera está estacionada; o disposer do listener é liberado pelo `detachListeners()` do canal por meio do `detach()` do controlador, em simetria com os listeners de canal irmãos. Coberto por três testes da TUI: a resolução adiada permanece silenciosa durante um commit não relacionado e se completa quando chega o commit da rota, uma mudança de alvo descarta a espera desatualizada, e depois do detach do canal um commit do registry não reentra mais na resolução.
