# Agent Note: New Session limpa a seleção e leva à tela inicial de estado vazio

Status: implemented
Archived: 2026-07-26

[English](2026-07-24-new-session-clears-to-empty-state.md) | Português

## Problema

O "New Session" da barra lateral criava e abria uma sessão em branco imediatamente, então a coluna central mostrava `ConversationRoot` com um transcript (registro textual da sessão) vazio e o composer residente. A tela NEW SESSION do Figma (`EmptyState` + hero com o `InputBar` compartilhado) só era renderizada quando `sessions.current` já estava undefined, então a página inicial era inalcançável a partir do controle principal de criação.

## Decisão

`SessionsService.clear()` apaga a seleção persistida e `list.current`. As entradas de criação de nível superior da barra lateral (`onCreate()` sem cwd: New Session e New Workspace) chamam `clear()`, para que `AppFrame` renderize `conversation.empty`. O primeiro envio do estado vazio ainda roda `conversation.startSession` (create → open → send) e reutiliza o mesmo componente `InputBar` do composer residente (`variant="hero"`). O "+" por projeto (`onCreate(cwd)`) mantém o criar-e-depois-abrir até que o seletor do estado vazio consiga aceitar um cwd pré-preenchido.

## Alternativas consideradas

**Manter o criar-e-depois-abrir para New Session e adicionar um segundo chrome vazio dentro de ConversationRoot quando o transcript estiver vazio.** Rejeitada: isso duplica o InputBar inicial e quebra a decisão de vazio→conteúdo, segundo a qual um único InputBar muda de posição em vez de trocar de componente.

**Rotear New Session por uma rota ou slot dedicado fora da seleção.** Rejeitada nesta passada: `conversation.empty` já é dono da UI inicial; limpar `current` é o ramo vazio existente.

## Consequências

New Session deixa de criar uma sessão no host até o primeiro envio. Recarregar depois do clear permanece no estado vazio. O "+" com escopo de projeto ainda cria imediatamente. `EmptyState` empilha o hero do Figma (Input_Bottom 75:8208) como peixe + título, um chip de workspace baseado em Menu acima do cartão e, depois, o `InputBar` compartilhado (`variant="hero"`, max-width 800, cartão r20 igual ao do composer, não um hero r24 mais alto), com um brilho elíptico suave (figma 313:14109) centralizado atrás do seletor + cartão e com largura travada à do cartão (proporção do asset `1051/776`), para que escale junto com ele. O chip usa o preenchimento suave de hover interativo + raio de 12px de 75:8208 e abre o MenuDropdown (figma 122:9481; `--dsw-specific-menu` + `--dsw-shadow-lv3`): linhas de basename com ícones de pasta e um check no fim, depois um separador e "New Workspace", cujo submenu (figma 419:16920) oferece "Use a existing folder" e "Create new". Use a existing folder abre o Dialog de caminho (texto do figma 451:18655: "Enter an existing folder path" / Open Folder) sobre uma máscara de viewport inteira (`--dsw-alias-bg-mask-1` + `--dsw-mask-blur`) e define o cwd do chip. Create new abre o mesmo chrome de Dialog para nomear uma pasta sob `host.describe().cwd`; o sucesso roda `sessions.createWorkspace` → `session.create` do host (mkdir recursivo) → `sessions.open`, então uma sessão padrão surge no novo workspace. O `InputBar` pinta o chrome inferior (anexar / Plan / Read-only / modelo) apenas com estado local de `<select>` nativo: os seams de plan, de acesso e de modelo do host continuam sem conexão.
