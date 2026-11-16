# Agent Note: Authenticated AUTH journeys in the keyless Web lane

Status: implemented

## Problem

The [web browser e2e lane](2026-07-24-web-gui-browser-e2e-lane.md) boots the shipped `arx web` composition through [the web test scaffold](../../../../apps/web/tests/scaffold.ts). That composition has no web identity, owner project storage or isolated project runtime, so the AUTH journeys of the project UI (`ui-auth`) had no keyless snapshot; they ran only in the native identity gates of `examples/web-identity`. Two AUTH fixes still lacked one: Resume pressed before the runtime's aggregated session list arrives, and an owned session's history after the supervisor restarts the project workers. A race that depends on when the Host answers a browser request also needed a way to hold that answer.

## Decision

Decided by the owner on 2026-11-16 (option A of the session-12 stop): extend the keyless Web lane with the authenticated composition instead of moving the journeys to the native gates.

- [auth-scaffold.ts](../../../../apps/web/tests/auth-scaffold.ts) starts the existing disposable identity fixture server of `examples/web-identity` (`browserFixture('user', false, true, true)`): real identity, cookies, CSRF, project storage, isolated runtime, the native test supervisor with in-process workers, and the built frontend from `apps/web/dist`. Sessions come from the fixture's `seed-history` command, a hand-built conversation, so no model is called and nothing is recorded; `worker-counts` proves it. The server itself is unchanged.
- `holdNextApiRequest` in [support.ts](../../../../apps/web/tests/support.ts) holds the page's next request to `/api/<method>` until the test releases it, so the Host first sees the request after the test has changed state.
- [auth-resume-before-list.e2e.ts](../../../../apps/web/tests/auth-resume-before-list.e2e.ts) holds the first `session.list`, presses Resume, checks that nothing opened, releases the list and checks the history, the single session row and zero model and tool calls. With the wait for the list's pull removed from `ui-auth` and the dist rebuilt, the session never opens and the scenario fails.
- Its golden records stable facts, not ARIA trees or coordinates, and every AUTH scenario skips record mode because it has nothing to record.

## Alternatives considered

**Add the AUTH plugins to the shipped-composition scaffold through an overlay.** The overlay cannot start a supervisor or its workers, and it would duplicate the identity fixture that the native gates already maintain.

**Goldens in the native identity gates.** They run only in the final dev-01 session, not in the keyless CI lane.

## Consequences

- AUTH journeys in the Web lane depend on `examples/web-identity/tests/browser-server.host.ts`; a change there can change these scenarios.
- History after a worker restart has no snapshot yet. The writer-handoff defect needs a writer lease that is still live at the restart, which in the browser means a turn in progress; a seeded session or a pending question leaves none, and a draft scenario passed with the handoff disabled. Covering it needs a turn in progress (a model call, even a scripted replay), which the owner decides.
- In this container the fixture's workers sometimes answer UI-side reads with transient 502 while they start; the scenarios do not count refused requests.
