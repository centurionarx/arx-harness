# Authenticated GitHub webhook overlay

This optional patch adds one signed GitHub route to the Web profile. Create the project and Workspace first, then set `ARX_WEBHOOK_PROJECT_ID`, `ARX_WEBHOOK_WORKSPACE_ID`, `ARX_WEBHOOK_REPOSITORY` (`owner/name`), and `GITHUB_WEBHOOK_SECRET` in the Host environment. The secret value stays outside `cordis.yml`; only its credential reference is configured.

Run from the repository root after building:

```sh
pnpm arx --profile web --patch examples/web-webhook/cordis.yml
```

Configure GitHub to send `issues` events to the deployment's `/hooks/github` URL with content type `application/json` and the same secret. The package does not create the GitHub hook, expose the local port, configure DNS or TLS, or change firewall rules. The WebServer's configured bind address and the operator's reverse proxy decide whether GitHub can reach the route.

The example admits at most two active deliveries and eight queued deliveries. It accepts only the configured repository and event. A valid new delivery is recorded before HTTP 202, then creates a `standard`, `workspace-write` Agent Session under the named project's exact Workspace. The prompt clearly separates the trusted review instruction from untrusted GitHub JSON.

Restart recovery never replays a possibly started delivery. A row left `processing` becomes `uncertain`, and signed redelivery remains deduplicated until trusted operator code verifies the outcome and calls the runtime's explicit `reconcile()` method. A completed ledger row means the Session's initial prompt was persisted; it does not assert model or repository success.
