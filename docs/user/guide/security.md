# Access and security

English | [Português](security.pt-BR.md)

The Web UI controls an agent that can read files, run tools, and use the credentials available to its host process. Treat access to that UI as access to the agent's operating environment, not as a read-only dashboard.

## Local access

The Web profile binds to `127.0.0.1:3080` by default. Keep that loopback binding for personal use; do not forward its port from a router or publish it from a container to an untrusted network. Other processes and users with access to the same host can still reach loopback, so run the harness under an operating-system account you trust.

The [HTTP server](../../../packages/host/webserver/README.md#known-limitations-and-deferred-work) provides no built-in authentication, TLS, or origin policy. Changing its bind address to `0.0.0.0` allows network clients to reach those unauthenticated routes. A workspace selection or an approval dialog does not authenticate a browser client.

## Remote access through SSH

For a personal remote host, keep the harness listening on loopback and use an authenticated SSH tunnel instead of exposing the Web port. Start the harness on the remote host with `arx web --no-open`, then run this command on your own machine, replacing `user@host` with your SSH destination:

```sh
ssh -N -L 127.0.0.1:13080:127.0.0.1:3080 user@host
```

Open `http://127.0.0.1:13080` locally. The tunnel's local listener is also loopback-only; close the SSH process when access is no longer needed. If the remote harness uses another port, replace the final `3080` with that port.

## Network deployment requirements

A deployment that cannot use a tunnel needs a separately operated access layer. Before making it reachable by other machines:

- Require authenticated, authorized access to every HTTP route and upgraded connection, not just the HTML page.
- Terminate TLS and enforce the intended browser-origin policy in that access layer.
- Keep the backend port unreachable except by the trusted access layer; protecting one public URL does not protect a second direct route to the backend.
- Verify unauthenticated requests and disallowed origins are rejected, including WebSocket upgrades, downloads, and API requests.
- Use a dedicated operating-system identity and separate state and credentials for users who must not share authority. The shared Web process is not a multi-tenant isolation boundary.

These controls are deployment responsibilities, not features enabled by a harness setting. Do not expose the raw server until they have been configured and tested.

## Tool permissions and credentials

Choose the narrowest filesystem policy that permits the task, review requested permission changes, and install only trusted plugins and presets. [Sandbox modes](../../../packages/sandbox/sandbox/README.md#known-limitations-and-deferred-work) describe file effects; they do not promise network isolation or credential isolation. Use an independently isolated environment when those restrictions are required.

Store credentials through the configured credential provider rather than in prompts or repository files. Protect the harness home directory and backups with operating-system access controls. Secret fields being hidden in settings responses does not prevent a trusted plugin or an authorized tool from using credentials available to the process.
