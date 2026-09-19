# Agent Note: Manutenção do pacote bubblewrap fixado para CI

Status: implemented

[English](2026-09-19-ci-bubblewrap-payload-maintenance.md) | Português

## Problema

O Ubuntu remove pacotes binários substituídos de seu arquivo ativo. A ausência do pacote bubblewrap fixado interrompe o provisionamento de CI antes da execução da cobertura ou dos snapshots da aplicação; repetir um HTTP 404 permanente não restaura essas verificações.

## Decisão

O [script de preparação de CI](../../../../scripts/prepare-ci-bubblewrap.sh) fixa o bubblewrap `0.9.0-1ubuntu0.3` do Ubuntu Noble e seu SHA256. A atualização do pacote verifica a assinatura do `InRelease` com o chaveiro do arquivo Ubuntu, o checksum assinado de `Packages.xz` e o checksum do pacote registrado nesse índice contra os bytes baixados. A extração continua restrita ao diretório do runner efêmero. A verificação do checksum e a sondagem funcional de namespaces continuam obrigatórias.

A validação na máquina de desenvolvimento verifica o pacote sem alterar a política de segurança do host. Uma sondagem negada pela política AppArmor existente da máquina é registrada como limite da validação; o runner hospedado de CI continua responsável por sua configuração existente de namespaces de usuário e pela sondagem funcional completa.

## Alternativas consideradas

**Repetir a tentativa com a versão removida.** Requisições repetidas a um pacote indisponível mantêm a mesma falha de provisionamento.

**Resolver um pacote sem versão fixa durante o CI.** Isso altera o binário de sandbox executado sem uma versão e um checksum revisáveis. Uma transação do gerenciador de pacotes também acrescenta o custo de manutenção de pacotes da imagem hospedada.

## Consequências

As verificações mantêm um pacote de sandbox reproduzível e interrompem a execução diante de downloads indisponíveis ou divergentes. Futuras remoções do arquivo exigem outra atualização verificada da versão fixada; essa manutenção não desabilita verificações de confinamento nem reduz os requisitos de cobertura.
