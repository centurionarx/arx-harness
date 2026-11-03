# Owned project storage fixture

- USER: projects and workspaces use generated opaque ids.
- History: 6 durable events, one owned metadata row, original raw JSONL page.
- USER_B and MASTER_ADMIN: both denied before history access.
- Grouping removal: histories and own workspace files preserved.
- Backup: private SQLite snapshots, histories and own volumes; keys and authority journal excluded.
- Restore: old cookies revoked, blocked USER stayed blocked, deleted session stayed denied.
- Legacy migration: unmapped logs denied; owner was never inferred from cwd.
- Runtime without an operator endpoint: execution stays unavailable.
- Operational worker/UID/mount/network isolation and production restore remain separate gates.
