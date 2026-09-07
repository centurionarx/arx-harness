# arx Harness

English | [Português](README.pt-BR.md)

arx Harness (`arx`) is a closed-source agent harness developed by CENTURIONarx.

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

arx Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @arx-ai/arx web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

It resolves `@arx-ai/arx` from the registry, so it works only where that release is published. Run it from outside a repository checkout: inside one, `npm exec` takes the command name from the workspace and then runs whichever `arx` the `PATH` already has — a previously installed release, not this checkout. [Run from source](#run-from-source) is how a checkout starts.

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/centurionarx/arx-harness.git
cd arx-harness
pnpm install
pnpm run build
pnpm arx web
```

`pnpm run build` prepares the repository artifacts. `pnpm arx web` uses those built artifacts without rebuilding.

That build carries no brand: the Web UI shows the `ARX Local Build` placeholder in place of the product mark, because the official mark ships only under the official client profile. Use `pnpm run build:official` to build the branded client from a checkout.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/centurionarx/arx-harness/discussions).
- Add the [`arx-plugin`](https://github.com/topics/arx-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">arx Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
