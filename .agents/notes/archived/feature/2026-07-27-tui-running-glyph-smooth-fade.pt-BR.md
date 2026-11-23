# Agent Note: Pulso cinza dim para o glifo de prompt em execução

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-tui-running-glyph-smooth-fade.md) | Português

## Problema

Enquanto um turno roda, a TUI substitui o caret `>` do prompt por um glifo de fase (`◍`/`✻`/`●`/`⚙`). Iterações anteriores animavam o brilho dele no azul accent (uma onda SGR discreta, depois uma pulsação em truecolor): um indicador colorido e sempre pulsante. O efeito desejado mantém o pulso contínuo para sinalizar trabalho em andamento, mas como um cinza dim discreto em vez de uma cor, e com fade-in e fade-out suaves nas bordas.

## Decisão

O glifo em execução é um cinza dim que entra em fade-in no início do turno, pulsa continuamente enquanto o turno roda e sai em fade-out depois que ele termina, antes de o caret `>` simples voltar. Ele nunca usa a cor accent.

O brilho é um envelope de fade multiplicado por uma pulsação de execução. O envelope controla o aparecer/desaparecer, linear no relógio de renderização ao longo de `STATUS_FADE_MS = 300`: `(now − startedAt)/FADE` limitado para o fade-in, `1 − (now − endedAt)/FADE` para o fade-out. `pulseLevel` é um cosseno entre `STATUS_PULSE_FLOOR` (0) e 1 ao longo de `STATUS_PULSE_PERIOD_MS = 1400`, então cada respiração cresce de totalmente invisível até o máximo e volta. A opacidade truecolor entregue a `fadeGlyph` é `envelope × pulse`.

`fadeGlyph` renderiza nessa opacidade. Com truecolor, abaixo de `STATUS_FADE_MIN_OPACITY` (0.12) o glifo fica totalmente oculto, uma coluna em branco, de modo que o vale do pulso desaparece em vez de persistir como um cinza quase igual ao fundo; acima disso, o glifo interpola um cinza de 24 bits entre `STATUS_FADE_GRAY.trough` e `.settled` (o mesmo cinza dim do caret ocioso), emitindo `\x1b[38;2;r;g;bm`, de modo que tanto o fade quanto a pulsação são brilho. Sem truecolor não há cinza por frame, então uma flag `visible` separada, guiada apenas pelo envelope e não pela opacidade pulsante, mostra o glifo no papel muted da paleta ou deixa uma coluna em branco; a pulsação nunca faz o fallback piscar. Com as cores totalmente desligadas, um glifo visível fica sem estilo, o que preserva a coluna do caret em um terminal monocromático.

O prompt em execução é atualizado a cada `STATUS_ANIMATION_INTERVAL_MS = 50` (~20 fps) para que a pulsação se mova a cada frame; o mesmo tick mantém atual o texto de tempo decorrido com resolução de 0,1 s, então não existe um timer de tempo separado.

O fade-out sobrevive ao turno: na transição de em execução → não em execução, `beginFadeOut` entrega o último glifo renderizado a um `FadingStatus` cujo timer próprio renderiza de novo até a janela de fade terminar, e então chama `clearStatus` e restaura `>`. Os caminhos de teardown (dispose, agent-disposed, startup-failure) chamam `clearStatus` diretamente, parando de uma vez os timers de execução e de fade, sem fade remanescente. O glifo entregue ao fade-out é o último glifo de fase vivo (`runningStatus.lastGlyph`), não o fallback de ttft que a derivação de fase retorna depois que a etapa do turno em encerramento terminou.

O caractere do glifo e a célula dele nunca mudam, só o brilho do cinza, então a coluna do caret permanece fixa entre os frames e nas transições caret↔glifo.

## Alternativas consideradas

**Manter a cor accent.** O pulso é desejado, mas como um cinza discreto que acompanha o tom do caret ocioso, não como um indicador colorido; o accent é removido e a pulsação permanece.

**Manter estável durante a execução (sem pulsação).** Um glifo dim estável foi testado e rejeitado: um pulso contínuo transmite melhor que o agent (agente) está trabalhando ativamente. A pulsação volta, em cinza.

**Um piso diferente de zero que mantém o vale levemente visível.** Pisos sucessivos (0.45 → 0.15 → 0.02) mantiveram, cada um, o ponto mais escuro visível demais para ser lido como realmente discreto; mesmo 0.02 ficava em um cinza ≈ 45, um passo acima do fundo. Um piso de 0 com um limiar de visibilidade explícito (`STATUS_FADE_MIN_OPACITY`) oculta totalmente o glifo no fundo de cada respiração, então o vale está genuinamente ausente. Como o crescimento é um cosseno suave, o desaparecimento é lido como um fade-out suave, não como o pisca-pisca brusco de ligado/desligado que uma alternância com um cinza baixo, mas diferente de zero, produziria.

**Pulsar também o fallback sem truecolor.** O SGR expõe apenas três níveis de intensidade, grosseiros demais para uma pulsação suave, e alternar o glifo entre ligado e desligado ao longo do pulso o faria piscar. O fallback mostra, em vez disso, um glifo muted estável controlado pelo envelope; só terminais truecolor recebem a pulsação.

## Consequências

O glifo em execução é lido como uma respiração cinza discreta que cresce do nada até uma marca dim e volta durante o turno inteiro, acompanhando o tom do caret ocioso, ao custo de um tick de renderização mais rápido (50 ms) enquanto um turno está ativo ou em fade-out; o terminal com diffing só reemite as células alteradas, então os frames extras são baratos. O fade-out faz o indicador persistir por ~300 ms depois que um turno termina. Os snapshots rodam sem truecolor e com o relógio congelado, então fixam apenas o glifo muted estável (controlado pelo envelope), não a pulsação; o vale invisível em truecolor, o pico estabilizado, um frame intermediário em subida, o fade-out e o aparecer/desaparecer sem truecolor são fixados por testes unitários em `tui.spec.ts`.
