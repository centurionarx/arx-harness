# arx Harness

[English](README.md) | Português

arx Harness (`arx`) é um agent harness de código fechado desenvolvido pela CENTURIONarx.

Ele usa uma arquitetura em que **tudo é um plugin**; é movido pelo [Cordis](https://github.com/cordiverse/cordis), cujo design é descrito em [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Prévia para desenvolvedores

arx Harness está atualmente em _developer preview_ e itera rapidamente. **HAVERÁ MUDANÇAS QUE QUEBRAM COMPATIBILIDADE.**

## Execução

### Executar a partir do `npm`

Instale o `Node.js` e execute:

```sh
npx @arx-ai/arx web
```

O comando inicia a Web UI em `http://127.0.0.1:3080` por padrão e a abre no navegador padrão em uma execução local. Uma execução via SSH imprime apenas a URL da máquina, porque o cliente ou editor SSH é dono do endereço encaminhado local. Passe `--no-open` para rodar o servidor sem abrir um navegador. Veja o [guia da Web UI](docs/user/guide/index.pt-BR.md).

### Executar a partir do código-fonte

Para executar a partir de um checkout do repositório:

```sh
git clone https://github.com/centurionarx/arx-harness.git
cd arx-harness
pnpm install
pnpm run build
pnpm arx web
```

`pnpm run build` prepara os artefatos do repositório. `pnpm arx web` usa esses artefatos construídos sem reconstruir.

## Comunidade e suporte

- Sinta-se livre para enviar feedback ou relatos de bugs pelo [GitHub Discussions](https://github.com/centurionarx/arx-harness/discussions).
- Adicione o tópico [`arx-plugin`](https://github.com/topics/arx-plugin) ao repositório do seu plugin para facilitar a descoberta.
- Participe da <a href="https://discord.gg/Ycq5dCaS4">comunidade arx Harness no Discord</a>.

## Contribuição

Veja [CONTRIBUTING.md](CONTRIBUTING.pt-BR.md).

## Desenvolvimento

Comece pelo [guia de desenvolvimento](docs/development.pt-BR.md) e pela [documentação de arquitetura](docs/architecture.pt-BR.md).

Para agentes, siga [AGENTS.md](AGENTS.md).

## Licença

[MIT](LICENSE)

Dependências de terceiros e suas licenças estão listadas em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).