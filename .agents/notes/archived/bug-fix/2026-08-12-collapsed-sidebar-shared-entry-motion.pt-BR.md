# Agent Note: Os controles superiores da barra lateral recolhida compartilham um único movimento de entrada

Status: implemented
Archived: 2026-08-12

[English](2026-08-12-collapsed-sidebar-shared-entry-motion.md) | Português

## Problema

O trilho da barra lateral recolhida renderiza quatro controles superiores que pertencem a dois pacotes: o shell é dono do botão de alternância e do New Session, enquanto a região do workspace é dona de adicionar e de buscar. A temporização de opacidade deles coincidia, mas a geometria não. Os controles alinhados à direita se moviam junto com a coluna que estreitava, enquanto os alinhados à esquerda ficavam fixos, de modo que adicionar parecia mais lento do que buscar mesmo sob o mesmo fade.

O controle de configurações na parte inferior tem um papel diferente. Ele fica fixado no rodapé do trilho e não deve participar da entrada horizontal dos controles superiores.

## Decisão

No ponto de assentamento do trilho, os quatro controles superiores de 36px partem de um único layout ancorado à esquerda e compartilham uma única animação de `150ms`, de `translateX(49px)` até o recuo final de 10px. O shell aplica a translação aos assentos do botão de alternância e do New Session e uma única vez à região do workspace, de modo que adicionar e buscar herdam o mesmo trajeto sem transformações aninhadas. A opacidade usa a mesma linha do tempo de animação.

O assento de configurações usa um keyframe separado, apenas de opacidade, com a mesma duração e o mesmo easing. Uma página que começa recolhida renderiza o trilho sem animação de entrada, e o modo de movimento reduzido desativa os dois keyframes.

## Alternativas consideradas

**Manter cada controle do trilho fixo no recuo final.** Isso elimina a divergência, mas também elimina dos quatro controles superiores a entrada horizontal que foi pedida.

**Animar cada botão do workspace de forma independente.** Isso duplicaria a temporização do shell dentro de `ui-workspace` e poderia aplicar tanto uma transformação da região quanto uma do filho. Transladar a região registrada uma única vez mantém a propriedade da animação no shell da barra lateral.

**Transladar o controle de configurações junto com os controles superiores.** Rejeitado porque configurações é uma ação de rodapé fixada na parte inferior, não parte da sequência de controles superiores.

## Consequências

- O botão de alternância, o New Session, adicionar e buscar seguem as mesmas coordenadas horizontais durante todo o recolhimento.
- Configurações faz o fade em sua coordenada horizontal final.
- As renderizações estáticas recolhidas conservam a geometria final sem movimento de inicialização.
- Os testes de estilo fixam as atribuições da animação compartilhada, a distância de translação, as âncoras de base e a exceção de configurações.
