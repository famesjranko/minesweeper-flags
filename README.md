# Minesweeper Flags

This is an homage to the MSN Messenger game I used to play with friends back in the day. A realtime two-player competitive Minesweeper with room-scoped match chat, shipped in two product shapes from the same monorepo:

- a **hosted server** build that talks to a Node WebSocket backend, and
- a **direct match** build (aka `p2p`) where one browser is the gameplay authority and a small HTTP signaling service brokers WebRTC rendezvous and reconnect.

The game flow is simple:

- player one creates a room (or hosts a direct match)
- player two joins with a private invite link, invite token, or direct-match join URL
- both players share a 16x16 board with 51 mines
- first to 26 claimed mines wins
- each player gets one 5x5 bomb comeback move that unlocks only while trailing by 4 or more
- room chat stays with the room through reconnects and rematches

> **Terminology.** "Direct match" is the user-facing product name for the browser-to-browser build. "P2P" (or `p2p`) is the matching technical mode name and the value of `VITE_DEPLOYMENT_MODE`. They refer to the same thing.

## Screenshots

### Lobby

![Lobby screen](docs/screenshots/lobby.png)

### Match

![Game screen](docs/screenshots/game.png)

## Stack

- React + Vite client in `apps/client`
- Node + `ws` realtime server in `apps/server` (hosted server flow)
- Lightweight HTTP signaling service in `apps/signaling` (browser-to-browser direct match flow)
- shared protocol/types in `packages/shared`
- pure game logic in `packages/game-engine`
- optional Redis-backed state persistence for rooms, matches, chat history, and reconnect sessions

The client ships in two product shapes selected at build time:

- `VITE_DEPLOYMENT_MODE=server` — hosted realtime server, room codes and invite links
- `VITE_DEPLOYMENT_MODE=p2p` — browser-to-browser direct matches over WebRTC, with the host browser as the gameplay authority and `apps/signaling` only used for offer/answer/reconnect rendezvous

## Architecture

- the server routes websocket input through a transport-neutral command layer before binding direct events and room broadcasts back to sockets
- the client separates controller behavior, runtime store, transport wiring, and the thin React provider boundary
- shared protocol modules distinguish commands, direct events, and room-stream events without changing the wire contract
- in P2P mode the host browser is the gameplay authority: `P2PHostOrchestrator` owns room, match, and chat state, and the same controller/store/transport layers apply to an `RTCDataChannel` transport instead of a `ws` socket
- the signaling service (`apps/signaling`) stays small and non-authoritative: it brokers offer/answer rendezvous and short-lived reconnect control sessions, and **never** stores gameplay state

See [`docs/p2p-architecture.md`](docs/p2p-architecture.md) for the full P2P design — actors, happy-path handshake, reconnect control session protocol, displacement / duplicate-tab handling, and recovery storage.

## Quick Start

Install dependencies:

```bash
make install
```

Run the app locally in dev mode:

```bash
make dev
```

That starts:

- the server in watch mode
- the Vite client in watch mode

For the direct-match (P2P) dev flow instead, run:

```bash
make p2p-dev
```

That starts the signaling service and the client (in `p2p` mode) in watch mode, with no hosted server. Equivalently, `make dev DEPLOYMENT_STYLE=p2p` dispatches to the same target.

For the convenience local Compose stack:

```bash
make compose-up
```

For the parity-first stack that matches the public deployment shape more closely:

```bash
make compose-public-up
```

For the local direct-match (P2P) stack with the signaling service instead of the hosted server:

```bash
make compose-p2p-up
```

For the parity/public direct-match stack:

```bash
make compose-public-p2p-up
```

Then open:

- `http://localhost:8080` for either Compose stack
- `ws://localhost:3001/ws` as the explicit backend socket URL in the parity stack
- the Vite URL printed by `make dev` for client-only dev mode

## Useful Commands

```bash
make help
make dev                       # server flow (default); pass DEPLOYMENT_STYLE=p2p to dispatch to p2p-dev
make p2p-dev                   # direct-match (P2P) flow: signaling + client in watch mode
make p2p-dev-redis             # same, with Redis-backed signaling for public-shape debugging
make server-dev
make signaling-dev
make client-dev
make test
make test-server
make test-signaling
make test-client
make test-shared
make test-engine
make build
make compose-config
make compose-up                # local stack: redis + server + signaling + client
make compose-p2p-up            # local p2p stack: signaling + client
make compose-down
make compose-public-config
make compose-public-up         # parity/public stack: redis + server + signaling + client
make compose-public-p2p-up     # parity/public p2p stack: redis + signaling + client
make compose-public-down
make check
```

See [`docs/config-reference.md`](docs/config-reference.md#common-make-targets) for the full list.

## Configuration

The main configuration reference is:

- [docs/config-reference.md](docs/config-reference.md)

Example env templates:

- [apps/server/.env.example](apps/server/.env.example)
- [apps/client/.env.example](apps/client/.env.example)
- [apps/client/.env.production.example](apps/client/.env.production.example)
- [deploy/container/public.env.example](deploy/container/public.env.example)
- [deploy/container/public.p2p.env.example](deploy/container/public.p2p.env.example)

Important behavior:

- the server does not auto-load `.env` files on its own
- `make dev`, `make server-dev`, and `make server-start` load `apps/server/.env` if it exists
- the client uses Vite build-time env vars such as `VITE_SOCKET_URL`
- the server defaults to `STATE_BACKEND=memory`
- `DEPLOYMENT_MODE=public` requires `STATE_BACKEND=redis`, explicit `WEBSOCKET_ALLOWED_ORIGINS`, and `TRUST_PROXY=true`
- local Docker Compose runs the server with Redis enabled
- the parity/public Compose overlay keeps frontend and backend on split origins, matching the public deployment model

## Local Development Modes

### Fast iteration

Use:

```bash
make dev
```

This is the simplest workflow when you are editing UI or server logic.

### Convenience Redis-backed local testing

Use:

```bash
make compose-up
```

This gives you:

- `redis`
- `server`
- `client`

The Compose client proxies `/ws` to the server, so same-origin play works out of the box.

### Parity-first local testing

Use:

```bash
make compose-public-up
```

This uses the baked-in localhost-safe defaults from [`deploy/container/docker-compose.public.yml`](deploy/container/docker-compose.public.yml).
It is the recommended path before a public deploy. It gives you:

- `redis`
- `server`
- `signaling`
- `client`
- `DEPLOYMENT_MODE=public`
- explicit `VITE_SOCKET_URL`
- split frontend/backend origins

To override the parity/public defaults with your own env file, run:

```bash
docker compose --env-file deploy/container/public.env.example -f deploy/container/docker-compose.public.yml up --build
```

See [deploy/container/README.md](deploy/container/README.md) for the env contract and public-hosting assumptions.

### Direct match (P2P) local stack

Use:

```bash
make compose-p2p-up
```

That runs `client + signaling` locally with `VITE_DEPLOYMENT_MODE=p2p` and in-memory signaling state. The host browser is the gameplay authority; signaling only brokers offer/answer rendezvous and reconnect control sessions. Open `http://localhost:8080`, click `Host Direct Match`, share the resulting `/p2p/join/:sessionId` link with the guest.

For the parity/public P2P shape instead:

```bash
make compose-public-p2p-up
```

That stack requires explicit `VITE_P2P_SIGNALING_URL`, `SIGNALING_ALLOWED_ORIGINS`, and `CSP_CONNECT_SRC` values — it fails fast rather than shipping a silently broken client. For localhost parity testing, copy `deploy/container/public.p2p.env.example` and point those variables at `http://localhost:3002` / `http://localhost:8080`.

For P2P development without containers, `make p2p-dev` runs the signaling service and the client directly in watch mode. `make p2p-dev-redis` is the same shape but with Redis-backed signaling for closer public-shape debugging.

See [`docs/p2p-architecture.md`](docs/p2p-architecture.md) for the design and [`docs/config-reference.md`](docs/config-reference.md#local-direct-match-stack) for the full recipe list.

## Testing

Run everything:

```bash
make test
```

Run only the server suite:

```bash
make test-server
```

Run only the client suite:

```bash
make test-client
```

The server currently has coverage around:

- realtime connection handling
- abuse prevention and rate limiting
- reconnect/session behavior
- state-store behavior for memory and Redis-backed paths
- health/readiness behavior
- room-scoped concurrency and rematch/cleanup race regressions

The client currently has coverage around:

- provider/controller/store integration
- session persistence and reconnect bootstrap behavior
- rematch UI state changes
- bomb availability and board-preview behavior
- direct-match (P2P) host/guest setup, refresh recovery, displacement and duplicate-tab handling

The signaling service has coverage around:

- offer/answer/finalization session lifecycle and TTL
- reconnect control sessions, role claims, heartbeat staleness, and stale-attempt reconciliation

## Health And Realtime Behavior

### Hosted server (`apps/server`)

Exposes:

- `/health` for liveness (also returns `activeRooms` / `maxRooms` slot availability)
- `/ready` for readiness

The realtime server includes:

- room create/join flows over WebSockets
- room-scoped live chat with reconnect-safe recent history
- reconnect support with stored session tokens
- configurable max concurrent rooms with lobby slot indicator
- per-IP connection caps and event throttling
- immediate room cleanup when all players disconnect
- heartbeat-based stale socket cleanup
- optional Redis-backed persistence
- strict public-mode config validation

### Signaling (`apps/signaling`, P2P flow)

Exposes:

- `/health` for liveness

The signaling service includes:

- offer/answer rendezvous endpoints under `/signaling/sessions/*`
- short-lived reconnect control sessions under `/signaling/reconnect/*` (register → claim → heartbeat → offer/answer → finalize, with role-aware displacement for duplicate tabs)
- per-IP rate limit buckets split into create / answer / reconnect families
- in-memory storage by default, Redis-backed in public mode
- strict public-mode config validation (Redis required, explicit origin allowlist, `TRUST_PROXY=true`)

Gameplay state never lives on the signaling service — the host browser is the authority. See [`docs/p2p-architecture.md`](docs/p2p-architecture.md) for the endpoint table and the reconnect control session state machine.

## Repo Layout

```text
apps/
  client/         React + Vite frontend (server and p2p builds)
  server/         Node realtime server (hosted flow)
  signaling/      Lightweight HTTP signaling service (p2p flow)
packages/
  game-engine/    Pure game rules and board logic
  shared/         Shared schemas, DTOs, and protocol definitions
docs/
  config-reference.md              Operator env + Compose reference
  p2p-architecture.md              P2P design, signaling endpoints, reconnect protocol
  transport-neutral-refactor-plan.md   Historical record of the server-flow refactor
deploy/
  container/
    docker-compose.public.yml      parity/public hosted-server overlay
    docker-compose.public.p2p.yml  parity/public direct-match overlay (stricter env contract)
    public.env.example
    public.p2p.env.example
    README.md
Makefile
docker-compose.yml                 local hosted-server stack
docker-compose.p2p.yml             local direct-match stack
```

## Notes

- Use `make dev` for fast editing and `make compose-public-up` for production-like validation.
- Public deployments are currently single-instance only and should use Redis.
- Multi-instance fanout is not implemented yet, so horizontal scaling still needs more work.
