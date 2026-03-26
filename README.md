# Minesweeper Flags

Realtime two-player competitive Minesweeper built as a small monorepo with a React client, a Node WebSocket server, and shared game/protocol packages.

The game flow is simple:

- player one creates a room
- player two joins with a room code or invite link
- both players share a 16x16 board with 51 mines
- first to 26 claimed mines wins
- each player gets one bomb comeback move

## Stack

- React + Vite client in `apps/client`
- Node + `ws` realtime server in `apps/server`
- shared protocol/types in `packages/shared`
- pure game logic in `packages/game-engine`
- optional Redis-backed state persistence for rooms, matches, and reconnect sessions

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

For a production-like local stack with Redis and nginx:

```bash
make compose-up
```

Then open:

- `http://localhost:8080` for the Compose stack
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
make check
```

## Configuration

The main configuration reference is:

- [docs/config-reference.md](docs/config-reference.md)

Example env templates:

- [apps/server/.env.example](apps/server/.env.example)
- [apps/client/.env.example](apps/client/.env.example)
- [apps/client/.env.production.example](apps/client/.env.production.example)

Important behavior:

- the server does not auto-load `.env` files on its own
- `make dev`, `make server-dev`, and `make server-start` load `apps/server/.env` if it exists
- the client uses Vite build-time env vars such as `VITE_SOCKET_URL`
- the server defaults to `STATE_BACKEND=memory`
- local Docker Compose runs the server with Redis enabled

## Local Development Modes

### Fast iteration

Use:

```bash
make dev
```

This is the simplest workflow when you are editing UI or server logic.

### Redis-backed local testing

Use:

```bash
make compose-up
```

This gives you:

- `redis`
- `server`
- `client`

The Compose client proxies `/ws` to the server, so same-origin play works out of the box.

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

## Health And Realtime Behavior

The backend exposes:

- `/health` for liveness
- `/ready` for readiness

The realtime server includes:

- room create/join flows over WebSockets
- reconnect support with stored session tokens
- per-IP connection caps and event throttling
- heartbeat-based stale socket cleanup
- optional Redis-backed persistence

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
Makefile
docker-compose.yml
```

## Notes

- The current repo is safe for local use, single-instance deployments, and Redis-backed restart safety.
- Multi-instance fanout is not implemented yet, so horizontal scaling still needs more work.
