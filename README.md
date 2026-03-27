# Minesweeper Flags

Realtime two-player competitive Minesweeper with room-scoped match chat, built as a small monorepo with a React client, a Node WebSocket server, and shared game/protocol packages.

The game flow is simple:

- player one creates a room
- player two joins with a room code or invite link
- both players share a 16x16 board with 51 mines
- first to 26 claimed mines wins
- each player gets one bomb comeback move
- room chat stays with the room through reconnects and rematches

## Screenshots

### Lobby

![Lobby screen](docs/screenshots/lobby.png)

### Match

![Game screen](docs/screenshots/game.png)

## Stack

- React + Vite client in `apps/client`
- Node + `ws` realtime server in `apps/server`
- shared protocol/types in `packages/shared`
- pure game logic in `packages/game-engine`
- optional Redis-backed state persistence for rooms, matches, chat history, and reconnect sessions

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

For the convenience local Compose stack:

```bash
make compose-up
```

For the parity-first stack that matches the public deployment shape more closely:

```bash
make compose-public-up
```

Then open:

- `http://localhost:8080` for either Compose stack
- `ws://localhost:3001/ws` as the explicit backend socket URL in the parity stack
- the Vite URL printed by `make dev` for client-only dev mode

## Useful Commands

```bash
make help
make dev
make server-dev
make test-server
make build
make compose-config
make compose-up
make compose-down
make compose-public-config
make compose-public-up
make compose-public-down
make check
```

## Configuration

The main configuration reference is:

- [docs/config-reference.md](docs/config-reference.md)
- [docs/two-player-chat-plan.md](docs/two-player-chat-plan.md)

Example env templates:

- [apps/server/.env.example](apps/server/.env.example)
- [apps/client/.env.example](apps/client/.env.example)
- [apps/client/.env.production.example](apps/client/.env.production.example)
- [deploy/container/public.env.example](deploy/container/public.env.example)

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
- `client`
- `DEPLOYMENT_MODE=public`
- explicit `VITE_SOCKET_URL`
- split frontend/backend origins

To override the parity/public defaults with your own env file, run:

```bash
docker compose --env-file deploy/container/public.env.example -f deploy/container/docker-compose.public.yml up --build
```

See [deploy/container/README.md](deploy/container/README.md) for the env contract and public-hosting assumptions.

## Testing

Run everything:

```bash
make test
```

Run only the server suite:

```bash
make test-server
```

The server currently has coverage around:

- realtime connection handling
- abuse prevention and rate limiting
- reconnect/session behavior
- state-store behavior for memory and Redis-backed paths
- health/readiness behavior
- room-scoped concurrency and rematch/cleanup race regressions

## Health And Realtime Behavior

The backend exposes:

- `/health` for liveness
- `/ready` for readiness

The realtime server includes:

- room create/join flows over WebSockets
- room-scoped live chat with reconnect-safe recent history
- reconnect support with stored session tokens
- per-IP connection caps and event throttling
- heartbeat-based stale socket cleanup
- optional Redis-backed persistence
- strict public-mode config validation

## Repo Layout

```text
apps/
  client/         React + Vite frontend
  server/         Node realtime server
packages/
  game-engine/    Pure game rules and board logic
  shared/         Shared schemas, DTOs, and protocol definitions
docs/
  config-reference.md
deploy/
  container/       parity/public compose overlay and docs
Makefile
docker-compose.yml
```

## Notes

- Use `make dev` for fast editing and `make compose-public-up` for production-like validation.
- Public deployments are currently single-instance only and should use Redis.
- Multi-instance fanout is not implemented yet, so horizontal scaling still needs more work.
