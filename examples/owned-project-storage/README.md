# Owned project storage keyless fixture

The runnable [snapshot.ts](snapshot.ts) composes the real Loader and checked-in identity template through [storageHarness](../../packages/identity/project-storage/tests/harness.ts). It loads native identity, its external authority journal, existing JSONL persistence, project storage, operator credential fixture and the isolated-runtime carrier. Every password/key/token is randomly generated for a private temporary fixture; no live account, real email or production configuration is used.

Run from the repository root:

```sh
node node_modules/tsx/dist/cli.mjs examples/owned-project-storage/snapshot.ts
```

The [snapshot golden](snapshot.expected.md) records safe ownership, durability, grouping, backup/restore and migration receipts, plus the control-answered `host.describe` and a host downlink merged over two workspace sub-streams. Own raw downloads preserve the existing JSONL bytes and can contain the owning volume's cwd; navigation DTOs only expose opaque ids and display names. A raw path is never an ownership credential and cannot be submitted as workspace provisioning authority.

The synthetic backup takes SQLite-native consistent snapshots and copies only disposable histories/volumes. It excludes the signing key, credential files and external authority journal. Restoring an old auth/index snapshot keeps the live external journal, revokes old cookies, preserves blocked users and deleted-resource tombstones, and denies logs without authoritative mapping. No interrupted tool is resumed by this process. Production quiescence, backup destination/encryption, retention, RPO/RTO and an actual restore drill remain operational gates.

## Performance fixture

[benchmark-native.ts](benchmark-native.ts) is the versioned AUTH-005/v2 runner. It prepares two USER workloads, 1000 sessions each (one exact 10 MiB decoded log and 999 logs at most 1 KiB), 10000 own 1 KiB files each, a 50-header page and 128 KiB initial history page. Each arm collects 100 samples per USER and operation after five warmups, with both USER tasks parallel and alternating baseline/candidate order. The full run retains 2100 raw samples, including 100 warmups, plus monotonic timing, p50/p95, phase throughput, resource checkpoints, event-loop delay and quiescence evidence.

Both arms load the real SDK, Replay and native worker/tool composition through [benchmark-native-tools.ts](benchmark-native-tools.ts). They share the fixture's operator-assigned mount and original FSLocal provider. History uses the same explicitly selected encoding in both arms; both append arms fsync the log and the candidate also commits its derived FULL SQLite index and revalidates ownership. Tool/model replay calls must be consumed completely. The native fixture proves exercised process and protocol behavior; it does not establish production VM, UID, mount or network separation.

The measured `auth005-native-none-second` run used `none` encoding and retained its request, gate receipt, raw `samples-and-report.json` and measurement audit. List/open p95 were 13.182/9.558 ms, below their 500 ms budgets. The overall gate remains FAIL: append/read/write candidate-to-baseline p95 ratios were 1.7794/2.9137/2.1108, exceeding the unchanged 1.10 maximum. Those measurements do not become PASS through architectural investigation or a faster isolated microbenchmark.

The original FSLocal provider synchronizes the staged file before atomic publication but does not synchronize its containing directory. V2 therefore does not prove crash-durable namespace publication. A post-operation directory fsync alone also cannot establish the required directory identity if ancestors or symlinks can change. Durable namespace publication requires a reviewed worker filesystem design and supervisor-controlled namespace on the authorized deployment target; neither the existing provider nor the benchmark is silently changed to claim that guarantee.

Run only in the agreed idle measurement window, with a fresh exclusive receipt directory and the pre-implementation baseline provenance JSON:

```sh
node node_modules/tsx/dist/cli.mjs examples/owned-project-storage/benchmark-native.ts <receipt-dir> none <baseline-provenance.json>
```

The older [benchmark.ts](benchmark.ts) and [benchmark-worker.ts](benchmark-worker.ts) are V1 microbenchmarks. Their fixture HTTP boundary and additional directory fsync do not represent equivalent production SDK/tool/worker flows; their blocking non-equivalence result remains preserved and cannot substitute for V2 or a deployment gate.

Actual VM/UID/mount/network separation, resource quotas, real supervisor TLS credentials, encrypted backups, namespace durability and a production restore drill require separately authorized topology and operating policy. No benchmark or fixture approves deployment.
