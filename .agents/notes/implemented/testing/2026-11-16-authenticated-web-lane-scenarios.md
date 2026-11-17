# Agent Note: Authenticated AUTH journeys in the keyless Web lane

Status: implemented

## Problem

The [web browser e2e lane](2026-07-24-web-gui-browser-e2e-lane.md) boots the shipped `arx web` composition through [the web test scaffold](../../../../apps/web/tests/scaffold.ts). That composition has no web identity, owner project storage or isolated project runtime, so the AUTH journeys of the project UI (`ui-auth`) had no keyless snapshot; they ran only in the native identity gates of `examples/web-identity`. Two AUTH fixes still lacked one: Resume pressed before the runtime's aggregated session list arrives, and an owned session's history after the supervisor restarts the project workers. A race that depends on when the Host answers a browser request also needed a way to hold that answer.

## Decision

Decided by the owner on 2026-11-16: extend the keyless Web lane with the authenticated composition instead of moving the journeys to the native gates, except history after a worker restart.

- [auth-scaffold.ts](../../../../apps/web/tests/auth-scaffold.ts) starts the existing disposable identity fixture server of `examples/web-identity` (`browserFixture('user', false, true, true)`): real identity, cookies, CSRF, project storage, isolated runtime, the native test supervisor with in-process workers, and the built frontend from `apps/web/dist`. Sessions come from the fixture's `seed-history` command, a hand-built conversation, so no model is called and nothing is recorded; `worker-counts` proves it. The server itself is unchanged.
- `holdNextApiRequest` in [support.ts](../../../../apps/web/tests/support.ts) holds the page's next request to `/api/<method>` until the test releases it, so the Host first sees the request after the test has changed state.
- [auth-resume-before-list.e2e.ts](../../../../apps/web/tests/auth-resume-before-list.e2e.ts) holds the first `session.list`, presses Resume, checks that nothing opened, releases the list and checks the history, the single session row and zero model and tool calls. With the wait for the list's pull removed from `ui-auth` and the dist rebuilt, the session never opens and the scenario fails.
- Its golden records stable facts, not ARIA trees or coordinates, and every AUTH scenario skips record mode because it has nothing to record.
- History after a worker restart stays in the native identity fixture: [native-history-after-restart.host.ts](../../../../examples/web-identity/tests/native-history-after-restart.host.ts) sends one turn through the fixture's code-built preview replay, restarts the workers and resumes the session. Its facts golden comes only from a `record` run; until one is committed, its compare mode fails.

## Alternatives considered

**Add the AUTH plugins to the shipped-composition scaffold through an overlay.** The overlay cannot start a supervisor or its workers, and it would duplicate the identity fixture that the native gates already maintain.

**Goldens in the native identity gates for every AUTH journey.** They run only in the final dev-01 session, not in the keyless CI lane. History after a worker restart is the exception: in the Web lane it needs a browser turn, and the native fixture already scripts one.

## Consequences

- AUTH journeys in the Web lane depend on `examples/web-identity/tests/browser-server.host.ts`; a change there can change these scenarios.
- The writer handoff needs the session writer's lease still retained at the restart, which takes a browser prompt; a seeded session or a pending question leaves none, so a Web-lane scenario without a turn passes with the handoff disabled.
- The worker binds one history capability from its latest workspace-scoped request (see the isolated project runtime's [Known Limitations](../../../../packages/host/isolated-project-runtime/README.md#known-limitations-and-deferred-work)). When the page opens a session, a broker call can carry the capability of a request that already ended, control refuses it and the page's read answers 502. The Web-lane scenarios do not count refused requests. In the native history scenario the refusal can leave the resumed session unusable in its worker, and that run fails at its replay step.
