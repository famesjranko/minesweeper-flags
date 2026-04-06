# minesweeper-flags — Working Notes for Claude

This file is a lightweight pointer for AI assistants and humans working in this repo. It is not a coding standards document. Existing code may not match every guideline below; that is fine. Apply these notes to **new and changed code**, not as a refactor mandate.

## What this project is

Realtime two-player competitive Minesweeper, shipped in two product shapes from one codebase:

- **Hosted server flow** (`VITE_DEPLOYMENT_MODE=server`) — clients talk to a Node `ws` realtime server.
- **P2P direct match flow** (`VITE_DEPLOYMENT_MODE=p2p`) — host browser owns gameplay; a small HTTP signaling service brokers WebRTC offer/answer rendezvous and short-lived reconnect control sessions.

## Repo layout

```
apps/
  client/         React + Vite frontend (server and p2p builds)
  server/         Node + ws realtime server (hosted flow)
  signaling/      HTTP signaling service (p2p flow)
packages/
  game-engine/    Pure game rules and board logic
  shared/         Schemas, DTOs, protocol types (consumed by all apps)
deploy/container/ Parity/public Compose overlays
docs/             User-facing reference docs
```

## Stack

- TypeScript across all workspaces, npm workspaces.
- Vitest for tests; tests are colocated next to source as `*.test.ts(x)`.
- React 19 + Vite for the client.
- Node + `ws` for the realtime server. Plain Node HTTP for signaling.
- Optional Redis-backed state for both server and signaling.
- Single-instance deployments today; cross-instance fanout is **not** implemented.

## How to verify changes

```bash
make check          # runs make test then make build (the canonical local verification)
make test           # all workspace tests
make test-client    # client only (vitest)
make test-server    # server only
make test-signaling # signaling only
make test-shared    # shared package
make test-engine    # game-engine

npx vitest run path/to/file.test.ts        # one file
npx vitest run path/to/file.test.ts -t "name pattern"  # one test
```

Always run from the repo root. Do not `cd` into workspaces unless the worktree changes.

## Non-negotiables (these guide design decisions)

These have caused real bugs when violated. New code must respect them; do not weaken them to ship a feature.

1. **Signaling stays small and non-authoritative.** No gameplay state on the signaling service. Signaling brokers offer/answer rendezvous and short-lived reconnect control sessions. The `apps/signaling` Redis schema is allowed to grow only with rendezvous metadata, never match state.
2. **Host browser is the gameplay authority in P2P mode.** The `P2PHostOrchestrator` owns match state. Guests reconnect into the host, never the other way around.
3. **`packages/game-engine` is pure.** No I/O, no globals, no `Date.now()` outside injected clocks. Deterministic given seed + actions.
4. **`packages/shared` is the protocol contract.** Changes here ripple to client, server, and signaling. Treat shared schema edits as breaking-by-default and update all consumers in the same change.
5. **Reuse canonical events.** Reconnect, refresh recovery, and rematch flows reuse the existing `room:*`, `chat:*`, and `match:*` events. Do not invent reconnect-only or recovery-only gameplay events when an existing event already carries the data.
6. **The game client is transport-neutral.** `apps/client/src/app/providers/game-client.controller.ts` does not know whether it is talking to a server `ws` or a host orchestrator. Don't add transport coupling there.
7. **Single-instance assumption.** Cross-instance pubsub does not exist. Don't add code that assumes it without also adding the fanout.

## Patterns worth keeping

- Tests live next to source. Mock at workspace boundaries (transport, persistence, scheduler), not at internal seams.
- Configuration is read once via `*/config/env.ts` modules and validated up front. Don't sprinkle `process.env` reads through business logic.
- Error messages shown to users live in the runtime/controller layer, not deep in transports.
- AbortControllers must be aborted before being nullified in teardown. Orphaning an in-flight `waitFor`/poll loop on an abort signal that never fires can starve the Node.js event loop and hang the process. (This is a real bug we fixed; do not reintroduce it.)
- Reconnect/recovery cleanup is role-aware: host-only paths clear host records, guest-only paths clear guest records, and displacement preserves records so the user can reclaim.

## Anti-patterns to flag in review

- **Floating promises.** `void` them explicitly or `await` them. Unhandled rejections in the runtime are silent landmines.
- **`any` and unchecked type assertions.** Both hide real type errors. Prefer narrowing.
- **`innerHTML` or React's raw HTML escape hatch with anything that could be user input.** Use `textContent` or proper React rendering.
- **Direct `localStorage` / `window` access without an SSR/Node guard.** Check `typeof window` or hide behind an injected persistence interface (see `P2PRecoveryPersistence`).
- **Synchronous fs / crypto / heavy CPU on hot request paths.** Node is single-threaded.
- **Unbounded retry loops or polls without an `AbortSignal`.** Every long-lived async loop must be cancellable from teardown.
- **New abstractions for one call site.** Inline first; extract only when the second use appears.
- **Adding gameplay state to signaling.** Always wrong (see non-negotiable #1).
- **Inventing reconnect-only contracts.** Reuse existing room/chat/match events first (see non-negotiable #5).
- **Cross-tab coordination via `BroadcastChannel` / storage events.** Use signaling claim ownership instead. Tab conflicts are resolved by who currently holds the reconnect role claim, not by browser-local messaging.

## Security boundaries

Validate at the system boundary; trust internal calls:

- **`apps/server`** validates inbound WebSocket commands via `packages/shared` schemas before routing to the room/match modules.
- **`apps/signaling`** validates HTTP request bodies via `packages/shared/p2p/signaling.schema.ts` and applies per-IP rate limits in `signaling-http.ts`.
- **`apps/client`** treats data from peers and signaling as untrusted. Render via React text APIs only; never inject peer-supplied HTML.
- `WEBSOCKET_ALLOWED_ORIGINS` and `SIGNALING_ALLOWED_ORIGINS` are required in public deployments. Do not bypass.
- `TRUST_PROXY=true` only when a single trusted ingress sits in front. Never blindly trust `X-Forwarded-For` otherwise.
- Secrets (host secret, guest secret) live in browser memory and recovery storage only. They must never appear in logs, errors shown to users, or telemetry.

## Documentation surfaces

These are user-facing and must stay in sync with shipped behavior:

- `README.md` — top-level overview, quick start, deployment shapes.
- `docs/config-reference.md` — env vars, deployment modes, recovery and conflict UX descriptions.
- `deploy/container/README.md` — public/parity Compose overlay notes.

There is no `CHANGELOG.md` in this repo; do not create one unless asked.

## Commit style

Single-line imperative summaries. A body is welcome for non-trivial changes but not required for small ones. Examples from `git log`:

```
Add secure invite tokens for room joins
Stop duplicate-tab reconnect thrash
Refactor transport flow and tighten bomb UX
```

Do not amend published commits. Do not skip pre-commit hooks.

## When in doubt

- Prefer the smallest correct change.
- Read the existing code in the affected workspace first; match its patterns.
- If a non-negotiable would be violated, push back on the requirement before writing code.
- Existing code that violates these notes is not a bug to fix unsolicited. Leave it alone unless the task requires touching it.
