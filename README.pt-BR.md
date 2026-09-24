# arx Harness

[English](README.md) | Português

arx Harness (`arx`) é um agent harness baseado em plugins desenvolvido pela CENTURIONarx.

Ele usa uma arquitetura em que **tudo é um plugin**; é movido pelo [Cordis](https://github.com/cordiverse/cordis), cujo design é descrito em [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Prévia para desenvolvedores

arx Harness está atualmente em _developer preview_ e itera rapidamente. **HAVERÁ MUDANÇAS QUE QUEBRAM COMPATIBILIDADE.**

<a id="run"></a>

## Execução

### Executar a partir do `npm`

Instale o `Node.js` e execute:

```sh
npx @arx-ai/arx web
```

O comando inicia a Web UI em `http://127.0.0.1:3080` por padrão e a abre no navegador padrão em uma execução local. Uma execução via SSH imprime apenas a URL da máquina, porque o cliente ou editor SSH é dono do endereço encaminhado local. Passe `--no-open` para rodar o servidor sem abrir um navegador. Veja o [guia da Web UI](docs/user/guide/index.pt-BR.md).

Ele resolve `@arx-ai/arx` a partir do registry, então só funciona onde essa release está publicada. Rode-o de fora de um checkout do repositório: dentro de um, o `npm exec` tira o nome do comando do workspace e em seguida executa o `arx` que o `PATH` já tiver — uma release instalada antes, não este checkout. [Executar a partir do código-fonte](#run-from-source) é como um checkout inicia.

<a id="run-from-source"></a>

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

Esse build não carrega a marca: a Web UI mostra o marcador `ARX Local Build` no lugar do símbolo do produto, porque o símbolo oficial só é embarcado no perfil oficial do cliente. Use `pnpm run build:official` para construir o cliente com a marca a partir de um checkout.

## Comunidade e suporte

- Sinta-se livre para enviar feedback ou relatos de bugs pelo [GitHub Discussions](https://github.com/centurionarx/arx-harness/discussions).
- Adicione o tópico [`arx-plugin`](https://github.com/topics/arx-plugin) ao repositório do seu plugin para facilitar a descoberta.
- Participe da <a href="https://discord.gg/Ycq5dCaS4">comunidade arx Harness no Discord</a>.

## Contribuição

Veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Desenvolvimento

Comece pelo [guia de desenvolvimento](docs/development.md) e pela [documentação de arquitetura](docs/architecture.md).

Para agentes, siga [AGENTS.md](AGENTS.md).

## Licença

[MIT](LICENSE)

Dependências de terceiros e suas licenças estão listadas em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).