# Agent Note: Propriedade das ferramentas de projeto e entrega por preset

Status: implemented

[English](2026-09-19-project-delivery-preset-ownership.md) | Português

## Problema

Ferramentas registradas no host ficam visíveis para todos os presets, inclusive o agente minimal de duas ferramentas fixas. Um domínio de projetos compartilhado pelos RPCs do navegador não exige o mesmo escopo de registro para seu consumidor voltado ao modelo.

## Decisão

Os presets standard, code e cordis montam os consumidores de projeto e entrega nos seus escopos permanentes. O host Web mantém o domínio durável de projetos e os serviços do navegador. Cada preset desabilita explicitamente o consumidor de projeto quando o host não fornece esse domínio; hosts raw podem reutilizar o preset sem instalar o domínio opcional. A entrega consome o sistema de arquivos já fornecido pelo host.

## Alternativas consideradas

O registro global quebra o catálogo fixo de minimal. Filtrar pelo nome do preset dentro da ferramenta duplicaria a política de composição no consumidor. Declarar as ferramentas em cada preset responsável preserva o contrato existente de registro por escopo.

## Consequências

Minimal mantém exatamente o shell da plataforma e o editor. Novos presets personalizados escolhem essas ferramentas por composição. O snapshot integrado de minimal verifica o isolamento pelo catálogo e pela busca direta; os goldens de conversas reproduzidas incluem a aba opcional de navegação por turnos.
