# Native identity fixture gates

These tests create disposable identity SQLite, journal, project volumes, HTTP servers, and private home directories. Authentication, cookies, CSRF, grants, ownership checks, Loader, the request index renderer, and client bundles are real. Outbound email is recorded in fixture memory and no real email is sent.

browser-server.host.ts --frontend mounts the actual built frontend modules and static server. A USER server and an isolated MASTER audience server share one identity/storage provider and one writer. The admin Context isolates webServer, webIdentityApi, and clientModules; their effect-owned registrations are disposed with the fixture. USER A, USER B, and MASTER use separate browser contexts.

The fixture's temporary resolution directory links only real package directories from the isolated staging tree, using each package's actual name and exports. The receipt lists these links. This is fixture composition evidence; it does not establish packed installation or deployment closure.

native-browser-gate.host.ts runs headless Playwright against these servers. The current phase covers public and admin application trees and USER storage with no runtime grant, so no project RPC is needed. It checks request-specific HTML before and after login and revocation, real owner denial, virtual project/workspace creation, saved history, account/logout, independent tabs, accessibility at desktop/mobile widths, and reset/invitation recovery transfer before the first bundle and auth GET. The delivery template uses reserved fixture domains; the driver rebases only the delivered pathname/fragment onto the dynamically bound same-audience fixture server and records that fact, without overriding any auth request or carrier. It records method/path only and safe screenshots; it creates no trace and logs no headers, cookies, credentials, or recovery links.

Run from the repository root after the build. Every location is explicit: the receipt directory, the private evidence directory that must contain it, and the frontend source baseline recorded before the build. A missing argument fails before any server starts. native-project-browser-gate.host.ts takes the same arguments.

    node node_modules/tsx/dist/cli.mjs examples/web-identity/tests/native-browser-gate.host.ts <evidence-root>/<receipt-dir> <evidence-root> <frontend-source-baseline.json>

Source/HTTP integration runs independently in packages/client/ui-auth/tests/auth-http.client.spec.ts. It imports actual source plugins for the application composition and uses real HTTP authority for every credential or ownership transition.

The complete USER project graph, real runtime worker, pending response carrier, stream/event isolation, cold resume/fork, and malicious preview browser gate remain separate requirements. An HTTP fixture or successful subprocess round trip does not prove VM UID, mount, or network isolation. Unconfigured execution must stay closed. Never replace authentication or ownership with a mock to make the browser gate pass.
