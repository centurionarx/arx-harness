# Running benchmarks

## Token-cost comparison

[`benchmark/`](benchmark/README.md) measures what a coding task costs in tokens on cxh and on another harness, over byte-identical inputs with a verifiable definition of success. Dry run is the default; nothing executes until `--execute` is passed.

```sh
node benchmark/tests/oracles.test.mjs      # oracles reject the unsolved fixture
node benchmark/tests/extractors.test.mjs   # extractors count correctly
node benchmark/run.mjs --arm as-shipped --reps 3
```

Read [`benchmark/README.md`](benchmark/README.md) before interpreting any result: token counts are tokenizer-dependent, so only the `--arm controlled` sweep compares harness architecture rather than two tokenizers.

## Task throughput

Follow [Get started with the Python SDK](docs/user/guide/python-sdk.md) to install the SDK and run the `jsonrpc-agent` minimal variant. Use separate workspaces and session IDs for independent benchmark tasks.
