# P2P Direct Match Architecture

This document describes how the direct-match (P2P) product shape is built. It is the companion to `docs/config-reference.md` (operator) and `deploy/container/README.md` (deployment).

Terminology note: throughout the docs, **direct match** is the user-facing product name for the browser-to-browser build; **P2P** (or `p2p`) is the corresponding technical mode name and the value of `VITE_DEPLOYMENT_MODE`. They refer to the same thing.

## Non-negotiable invariants

These are the rules the feature is built around. Everything below should be read as a consequence of them.

1. **Signaling stays small and non-authoritative.** The signaling service brokers offer/answer rendezvous and short-lived reconnect control sessions. It never stores match state, chat history, room rosters, or anything else the host browser owns.
2. **The host browser is the gameplay authority.** `P2PHostOrchestrator` in `apps/client/src/p2p/host/p2p-host-orchestrator.ts` owns the canonical match, chat, and room state. Guests reconnect into the host, never the other way around.
3. **The game client is transport-neutral.** Whether commands are flowing over a `ws` socket to the hosted server or over an `RTCDataChannel` to a host browser, the client's controller layer sees the same command/event shapes. P2P-specific wiring lives entirely under `apps/client/src/p2p/`.
4. **Reuse canonical events.** Reconnect, refresh recovery, and rematch flows reuse the existing `room:*`, `chat:*`, and `match:*` events. The `P2PHostOrchestrator` builds those same events via `buildRoomCreatedEvent`, `buildChatHistoryEvent`, `buildMatchStartedEvent`, etc. — there is no P2P-only gameplay event vocabulary.
5. **Peer data is untrusted.** The client treats anything coming from the host or signaling as untrusted input: rendered through React text APIs only, validated against `packages/shared` schemas at the boundary.

If a change would violate one of these, push back on the requirement before writing the code.

## Actors

| Actor | Where it runs | What it owns |
| --- | --- | --- |
| **Host browser** | Player 1's tab | `P2PHostOrchestrator` state: room, chat history, match. Holds the `hostSecret`. Signs reconnect control sessions into existence after a guest joins. |
| **Guest browser** | Player 2's tab | `ClientSession` (room code, display name, session token). Holds the `guestSecret` delivered through the RTCDataChannel by the host. |
| **Signaling service** | `apps/signaling` (single Node process) | Short-lived offer/answer session rows and reconnect control session rows. In-memory by default, Redis-backed in public mode. Never stores gameplay state. |
| **STUN server(s)** | External, optional | NAT traversal for the ICE handshake. Configured via `VITE_P2P_STUN_URLS`. |

## Workspaces

```
apps/signaling/                                HTTP signaling service
  src/config/env.ts                            Runtime env parsing + public-mode validation
  src/http/signaling-http.ts                   Router, origin allowlist, rate limits
  src/modules/signaling/signaling.service.ts   Session + reconnect control session logic
  src/modules/signaling/signaling.repository.ts  Memory + Redis implementations
  src/state/state-backend.ts                   STATE_BACKEND selector

apps/client/src/p2p/
  pages/P2PJoinPage.tsx                        Guest join UI at /p2p/join/:sessionId
  setup/                                       Host/guest setup controller + store
  signaling/p2p-rendezvous-client.ts           HTTP client for the signaling service
  signaling/p2p-signaling.codec.ts             Offer/answer payload encode/decode
  signaling/p2p-signaling-url.ts               Join-URL builder
  host/p2p-host-orchestrator.ts                Authoritative match engine wrapper
  host/p2p-host-events.ts                      Fanout step helpers (broadcast/host-local/guest)
  host/p2p-host-session.ts                     Host/guest session record shapes
  host/p2p-host-state.ts                       Host runtime state + recovery snapshot types
  runtime/create-p2p-game-client-runtime.ts    Wires the host orchestrator into the transport-neutral client runtime
  transport/                                   RTCDataChannel transport adapter
  storage/p2p-recovery-storage.ts              localStorage-backed recovery persistence
  storage/p2p-recovery-storage.schema.ts       Zod schema for recovery records
  recovery/p2p-recovery-control.ts             Host-to-guest recovery control message (sent over the data channel)

packages/shared/src/p2p/signaling.schema.ts    Wire contract for all signaling endpoints
```

## Happy path: setting up a direct match

```
Host browser              Signaling                     Guest browser
─────────────             ─────────                     ─────────────
RTCPeerConnection
createOffer()
  │
  ▼
POST /signaling/sessions ────────────►  create row
  { offer }                             { sessionId, hostSecret, offer, state: "open" }
                                  ◄────
store { sessionId, hostSecret }
build join URL:
  ${origin}/p2p/join/${sessionId}
share link ────────────────────────────────────────────►
                                                        navigate to /p2p/join/:sessionId
                                                        GET /signaling/sessions/:id
                                                  ◄──── load row
                                                        (read offer)
                                                        RTCPeerConnection
                                                        setRemoteDescription(offer)
                                                        createAnswer()
                                                        POST /signaling/sessions/:id/answer
                                                        { answer: { sdp, displayName, ... } }
                                        transition
                                        state "open" → "answered"
                                        ◄──────────────
poll POST /signaling/sessions/:id/answer/read
  { hostSecret }
  ◄────── { answer }
setRemoteDescription(answer)

ICE connectivity checks via STUN ────────────────────────────────►
                                                            ◄──── data channel open

POST /signaling/sessions/:id/finalize
  { hostSecret }
  ◄────── state "answered" → "finalized"
```

Key points:

- Only the host ever possesses `hostSecret`. Only the host can read the guest's answer (`POST /signaling/sessions/:id/answer/read` requires `hostSecret`) or finalize the session.
- The guest posts an answer exactly once. A second `answer` attempt on the same session returns **409** (`SignalingSessionConflictError`).
- `P2P_SIGNALING_SESSION_TTL_SECONDS` (default `900`) is how long the row stays "active". After that the service reports `state: "expired"` and returns **410** on write attempts.
- Redis-backed signaling keeps expired rows around for a brief grace window so polling reads can surface `expired` before cleanup, instead of a raw **404**.
- Error codes are uniform across the signaling router: **404** not found, **403** forbidden (wrong secret), **410** expired, **409** conflict, **429** rate limited, **413** payload too large, **400** invalid JSON. See `apps/signaling/src/http/signaling-http.ts:746-780`.

After finalize, the host tears down its signaling client. Gameplay flows exclusively over the `RTCDataChannel`.

## Once connected: how gameplay flows

The host browser runs a **game client runtime** that is indistinguishable from the hosted-server runtime from the controller's point of view. The transport-neutral `game-client.controller` dispatches canonical commands (`room:create`, `room:join`, `match:action`, `chat:send`, `match:resign`, `match:rematch-request`, `match:rematch-cancel`, `player:reconnect`). In P2P mode:

- **Host-local commands** are applied directly to the `P2PHostOrchestrator`, which emits `P2PHostFanoutStep`s (broadcast / host-local / guest) that are then delivered to the host's own store and to the guest via the data channel.
- **Guest commands** flow over the data channel as `{ bindingId, event: ClientEvent }`. The host's transport adapter routes them through `P2PHostOrchestrator.applyRemoteGuestCommand`, which re-dispatches them as host-side commands against the same orchestrator. Out-of-scope commands (wrong binding, wrong room) get a `SERVER_EVENT_NAMES.serverError` back to the guest rather than being applied.
- **Server-side events** are the same shapes the hosted `apps/server` emits (`roomCreated`, `roomJoined`, `roomState`, `chatHistory`, `chatMessage`, `matchStarted`, `matchState`, `matchEnded`, `matchRematchUpdated`, `playerReconnected`). The guest's store does not know whether they came from a socket or a data channel.

This is non-negotiable #4 in practice: reconnect, rematch, chat history replay, and refresh recovery reuse the same events as the hosted flow.

## Recovery storage (browser-local)

Both host and guest persist a recovery record to `localStorage` under the key `msf:p2p-recovery:{roomCode}`. The shape lives in `apps/client/src/p2p/storage/p2p-recovery-storage.schema.ts`:

| Field | Host record | Guest record |
| --- | --- | --- |
| `version` | `P2P_RECOVERY_STORAGE_VERSION` | same |
| `role` | `"host"` | `"guest"` |
| Identity | `hostSession`, `guestSession` (nullable) | `playerId`, `displayName`, `sessionToken` |
| Gameplay | `room`, `chatMessages`, `match` | — (guest never owns gameplay state) |
| `reconnect` | `{ controlSessionId, hostSecret, guestSecret, lastInstanceId? }` | `{ controlSessionId, guestSecret, lastInstanceId? }` |

Invariants:

- Only the **host** persists gameplay state (room/match/chatMessages). The guest's record is identity + reconnect metadata only.
- The `reconnect` block on each record is what lets the browser rejoin a reconnect control session after a refresh.
- `lastInstanceId` is per-tab and changes on every fresh mount, which is how displacement between tabs is detected (see below).
- The host serializes via a byte-stable codec (`validateHostAuthoritySnapshot` preserves the original property order from `createMatchState`) so a write-then-reparse round-trip is identity-safe. Do not reorder fields in the schema without updating the serializer.

There is no server-side copy of either record. If both peers lose their browser state, the match is gone.

## Reconnect control sessions

After finalize, the host registers a **reconnect control session** on signaling. This is a second, separate session type — distinct from the offer/answer session above — designed for "renegotiate the data channel after a refresh" rather than "stand up a fresh connection".

Why it exists: when a tab refreshes, WebRTC state is lost. The peers can't just "resume" — they need a fresh SDP exchange. But the signaling system has to know *which* peers are authorized to do that, and it must survive cases like "the host refreshes while the guest is still live", "both refresh", and "a second tab steals control from the first". The reconnect control session models all of that on the signaling side with minimal state.

### Shape

Lives under `/signaling/reconnect/:id/*`. The repository record has:

```
sessionId, state: "open" | "finalized" | "expired", createdAt, expiresAt,
host:   { secret, instanceId, lastHeartbeatAt }
guest:  { secret, instanceId, lastHeartbeatAt }
attempt: {
  status: "idle" | "offer-ready" | "answer-ready" | "finalized" | "expired",
  offer, answer,
  finalizationOutcome: "reconnected" | "aborted" | null,
  finalizedBy, finalizedAt
}
```

Both `hostSecret` and `guestSecret` are minted by the host during setup and delivered to the guest over the data channel via `P2PRecoveryControlMessage` (`apps/client/src/p2p/recovery/p2p-recovery-control.ts`). After that, both sides persist their own secret in their recovery record.

### Endpoint family

All POSTs; all carry `secret + instanceId` in the body:

| Route | Who calls it | Purpose |
| --- | --- | --- |
| `POST /signaling/reconnect/:id/register` | Host | Create the control session record. Must be unique; duplicates **409**. |
| `POST /signaling/reconnect/:id/read` | Either | Read control session metadata (claim status, attempt status). Auth-checked. |
| `POST /signaling/reconnect/:id/claim` | Either | Claim a role (`host` or `guest`) for a given `instanceId`. Replacing an existing `instanceId` for the same role triggers attempt reconciliation (see below). |
| `POST /signaling/reconnect/:id/heartbeat` | Either | Refresh `lastHeartbeatAt` and the session expiry. Client cadence is 3s; server stale timeout is 10s. |
| `POST /signaling/reconnect/:id/offer` | Host | Write a fresh reconnect offer SDP. Moves `attempt.status` → `offer-ready`. |
| `POST /signaling/reconnect/:id/offer/read` | Either | Read the current offer (if any). |
| `POST /signaling/reconnect/:id/answer` | Guest | Write a reconnect answer. Requires `attempt.status === "offer-ready"` else **409**. Moves → `answer-ready`. |
| `POST /signaling/reconnect/:id/answer/read` | Either | Read the current answer (if any). |
| `POST /signaling/reconnect/:id/finalize` | Either | Finalize the attempt with outcome `reconnected` or `aborted`. Moves → `finalized`. |
| `POST /signaling/reconnect/:id/finalization/read` | Either | Read finalization outcome. |
| `GET  /signaling/sessions/:id` | Anyone with the id | Read the *offer/answer* session (not the reconnect control session). Rate-limited by the reconnect bucket. |

All reconnect endpoints share a single rate-limit bucket (`SIGNALING_RECONNECT_RATE_LIMIT_MAX`, default `240/min/IP`). This is high because of the polling cadence on reads, not just heartbeats. The bucket also covers the `GET /signaling/sessions/:id` offer/answer read path. See the comment block at `apps/signaling/src/config/env.ts:149-157`.

### Claim status lifecycle

Per-role claim state as visible to callers (`toVisibleReconnectRoleClaim`):

- `"unclaimed"` — no `instanceId` yet.
- `"claimed"` — an `instanceId` is bound and its last heartbeat is within the 10-second stale window.
- `"stale"` — an `instanceId` is bound but its last heartbeat is older than 10s. A new instance may claim this role without conflict; an existing instance with the same id may resume it with a heartbeat.

### Attempt status lifecycle

```
idle ──(host writes offer)──► offer-ready
                                 │
                                 │ (guest writes answer)
                                 ▼
                             answer-ready
                                 │
                                 │ (either finalizes with outcome)
                                 ▼
                             finalized
                             (+ expired via TTL from any state)
```

### Displacement: what happens when a second tab opens

Claim replacement happens when `/reconnect/:id/claim` is called with a matching `secret` but a different `instanceId` than the currently bound one. The service accepts the new `instanceId` (the newcomer wins) and then **reconciles the in-flight attempt** through `withReconnectAttemptReconciledForRoleReplacement`:

- **Host displacement.** If the attempt was `offer-ready`, `answer-ready`, or `finalized(aborted)`, the attempt is cleared back to `idle` and the session state flips to `"open"`. A displaced host cannot quietly hand off mid-SDP-exchange.
- **Guest displacement.** If the attempt was `answer-ready`, the answer is cleared and the status rolls back to `offer-ready` so the new guest tab can submit a fresh answer against the existing host offer. If the attempt was `finalized(aborted)`, it's rebuilt fresh. Otherwise the attempt is left alone.

Meanwhile, the displaced tab's next heartbeat or read fails with **403** (`SignalingSessionForbiddenError`) because its `instanceId` is no longer the active claimant. That's the signal the client uses to show the conflict notice.

The host UI surfaces the conflict at `apps/client/src/pages/RoomPage.tsx:173-206`:

> Another tab has claimed control. Close other tabs for this room, or reconnect to reclaim control.

Clicking **Reconnect** triggers a fresh `/claim` from the displaced tab with a new `instanceId`, reversing the roles and reconciling the attempt the same way. This is cross-tab coordination via the signaling claim, **not** via `BroadcastChannel` or storage events — which is intentional and is an explicit anti-pattern in `CLAUDE.md`.

If the signaling session has disappeared entirely (404/410) by the time the displaced tab tries to reclaim, the client treats it as "gone for good" and prompts the user to start a new direct match instead. The displaced tab keeps its recovery record until that point so the user can try.

### TTLs

- Offer/answer signaling session: `P2P_SIGNALING_SESSION_TTL_SECONDS` (default `900`).
- Reconnect control session: same value by default. The service constructs its options with `{ sessionTtlSeconds: P2P_SIGNALING_SESSION_TTL_SECONDS }` from `apps/signaling/src/index.ts:55-57`. There is no separate env var for it. Every successful mutating call refreshes `expiresAt` via `withRefreshedReconnectControlSessionExpiry`.
- Heartbeat stale timeout: hardcoded to `10_000ms` in `SignalingService`. Matches the 3s client heartbeat cadence with ~3x headroom.

## Role-aware cleanup

Reconnect and recovery cleanup is role-aware. This is a deliberate consequence of non-negotiable #2:

- **Host-only paths** clear host recovery records and host reconnect metadata.
- **Guest-only paths** clear guest records.
- **Displacement paths** intentionally do **not** delete the displaced tab's recovery record. The user needs that record to click "Reconnect" and reclaim.

If you're writing a new teardown path, figure out which role is tearing down before you wire it up. Clearing the wrong side's record on a shared action has been a real bug in this codebase.

## Security boundaries

| Boundary | What's validated | Where |
| --- | --- | --- |
| Browser → signaling (HTTP body) | Zod schemas from `packages/shared/src/p2p/signaling.schema.ts` | `apps/signaling/src/http/signaling-http.ts` (every route calls `.parse` on the body) |
| Browser → signaling (origin) | `SIGNALING_ALLOWED_ORIGINS` allowlist; public mode rejects `*` | `apps/signaling/src/config/env.ts:178-182`, `signaling-http.ts` CORS + preflight |
| Browser → signaling (rate) | Per-IP buckets split into create / answer / reconnect families | `signaling-http.ts` abuse-prevention hooks |
| Host → guest (data channel) | Canonical server-event shapes + `matchesGuestBinding` / `matchesGuestCommandScope` scope checks | `p2p-host-orchestrator.ts:229-283` |
| Guest → host (data channel) | Same scope checks; out-of-scope gets `serverError` reply | same |
| Peer text in UI | React text APIs only; never `innerHTML` for peer-supplied content | client `features/` and `pages/` |
| Host/guest secrets | Live in browser memory + recovery storage only; never logged or shown in error text | by convention across `p2p/` |

Public deployment additionally requires:

- `DEPLOYMENT_MODE=public`
- `STATE_BACKEND=redis` + `REDIS_URL`
- `SIGNALING_ALLOWED_ORIGINS` set to an explicit allowlist (no `*`)
- `TRUST_PROXY=true` behind a single trusted ingress that overwrites or rightmost-appends `X-Forwarded-For`

All four are enforced at signaling startup; any missing value throws before the server listens.

## What signaling will never know

Because non-negotiable #1 is load-bearing, this is worth spelling out. Signaling never stores, logs, proxies, or otherwise touches:

- Room state, roster, chat history, or invite tokens.
- Match state, board seed, moves, bomb availability, or score.
- Player display names (except as opaque bytes inside the guest's answer SDP payload during handshake — signaling does not inspect it).
- Session tokens or anything else used for in-match authorization.

The reconnect control session schema is allowed to grow with rendezvous metadata (claim status, attempt status, SDP, heartbeats), but not with match state. Adding a `matchPhase`, `score`, `currentTurn`, or similar field to the signaling repository would violate this invariant even if "just for debugging". Push back on the requirement before writing the code.

## Related docs

- `docs/config-reference.md` — full env var reference, Compose overlays, and deployment recipes
- `deploy/container/README.md` — container deployment contract for the parity/public overlays
- `CLAUDE.md` — non-negotiables and anti-patterns (the source this doc is derived from)
- `packages/shared/src/p2p/signaling.schema.ts` — authoritative wire contract
