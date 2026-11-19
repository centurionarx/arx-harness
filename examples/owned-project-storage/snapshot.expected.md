# Owned project storage fixture

- USER: projects and workspaces use generated opaque ids.
- History: 6 durable events, one owned metadata row, original raw JSONL page.
- USER_B and MASTER_ADMIN: both denied before history access.
- Grouping removal: histories and own workspace files preserved.
- Backup: private SQLite snapshots, histories and own volumes; keys and authority journal excluded.
- Restore: old cookies revoked, blocked USER stayed blocked, deleted session stayed denied.
- Legacy migration: unmapped logs denied; owner was never inferred from cwd.
- Runtime without an operator endpoint: execution stays unavailable.
- Runtime host.describe: control answers {"ok":true,"value":{"version":"0.0.0","cwd":"","attachedSessions":0,"home":"","canOpenPath":false}} with 0 supervisor requests.
- Host downlink over two workspaces: opened idle; each first scoped request attached its sub-stream first (/api/events.host A, /api/llm.providers A, /api/events.host B, /api/llm.providers B); merged frames: session A, session B; closing left 0 supervisor operations and cancelled 2 sub-leases.
- Operational worker/UID/mount/network isolation and production restore remain separate gates.
