# Configuration Reference

This file is the operator-facing reference for the current repo configuration surface.

Source of truth in code:

- `apps/server/src/app/config/env.ts`
- `apps/server/src/app/state/state-backend.ts`
- `apps/client/src/lib/config/env.ts`
- `apps/client/Dockerfile`
- `docker-compose.yml`

Example templates in repo:

- `apps/server/.env.example`
- `apps/client/.env.example`
- `apps/client/.env.production.example`

## At A Glance

The project currently has three configuration layers:

1. Server runtime environment variables.
2. Client build-time variables.
3. Local Docker Compose defaults.
4. Repo-level `Makefile` shortcuts for dev and testing.

The server reads environment variables at process start.
The client resolves its WebSocket endpoint at build time through Vite env vars.

Important:

- The server does not currently auto-load `.env` files.
  Use the server example file as a template for platform env vars, shell exports, or Compose values.
- The Vite client does read `.env` files from `apps/client` during the client build.
- The repo `Makefile` loads `apps/server/.env` for `make dev`, `make server-dev`, and `make server-start` if that file exists.

## Common Make Targets

Run these from the repo root:

- `make help` shows the available shortcuts.
- `make dev` runs the server and client in watch mode.
- `make server-dev` runs only the server in watch mode.
- `make test-server` runs the server test suite.
- `make build` builds all workspaces.
- `make compose-up` starts the local Docker Compose stack.
- `make compose-down` stops the local Docker Compose stack.
- `make check` runs tests, builds, and validates the Compose config.

## Server Runtime Variables

These are read by the Node backend in `apps/server/src/app/config/env.ts`.

Example template:

- `apps/server/.env.example`

| Variable | Default | Valid values | Required | What it does |
| --- | --- | --- | --- | --- |
| `PORT` | `3001` | numeric string | no | HTTP and WebSocket listen port. |
| `HOST` | `0.0.0.0` | host or bind address | no | HTTP and WebSocket bind address. |
| `WS_PATH` | `/ws` | path string | no | WebSocket upgrade path. |
| `TRUST_PROXY` | `false` | `true` or `false` | no | When `true`, per-IP abuse controls use the first `X-Forwarded-For` address instead of the direct TCP peer. Only enable this behind a trusted proxy or load balancer. |
| `MAX_CONNECTIONS_PER_IP` | `6` | positive integer | no | Maximum concurrent WebSocket connections allowed per client IP. |
| `ROOM_CREATE_RATE_LIMIT_MAX` | `4` | positive integer | no | Number of room-create events allowed per window per client IP. |
| `ROOM_CREATE_RATE_LIMIT_WINDOW_MS` | `60000` | positive integer | no | Window size in milliseconds for room-create rate limiting. |
| `ROOM_JOIN_RATE_LIMIT_MAX` | `10` | positive integer | no | Number of room-join events allowed per window per client IP. |
| `ROOM_JOIN_RATE_LIMIT_WINDOW_MS` | `60000` | positive integer | no | Window size in milliseconds for room-join rate limiting. |
| `INVALID_MESSAGE_RATE_LIMIT_MAX` | `5` | positive integer | no | Number of invalid client messages allowed per window per client IP before the socket is closed. |
| `INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS` | `30000` | positive integer | no | Window size in milliseconds for invalid-message throttling. |
| `SOCKET_HEARTBEAT_INTERVAL_MS` | `30000` | positive integer | no | Ping interval used to detect stale WebSocket connections. |
| `CHAT_MESSAGE_MAX_LENGTH` | `200` | positive integer | no | Maximum accepted chat message length after trimming. |
| `CHAT_HISTORY_LIMIT` | `25` | positive integer | no | Number of recent room-chat messages retained per room. |
| `CHAT_MESSAGE_RATE_LIMIT_MAX` | `8` | positive integer | no | Number of chat messages allowed per player within the configured chat window. |
| `CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS` | `10000` | positive integer | no | Window size in milliseconds for per-player chat throttling. |
| `STATE_BACKEND` | `memory` | `memory`, `redis` | no | Selects the backing store for rooms, matches, room chat history, and reconnect sessions. |
| `REDIS_URL` | unset | Redis URL | yes when `STATE_BACKEND=redis` | Redis connection string used by the shared-state adapters. |
| `REDIS_KEY_PREFIX` | `minesweeper-flags` | string | no | Prefix for all Redis keys written by the app. |
| `RECONNECT_SESSION_TTL_SECONDS` | `1800` | positive integer | no | TTL for reconnect-session records and their room index entries. |

### Notes

- All rate-limit and heartbeat values use a positive-integer parser.
  Invalid, empty, zero, or negative values fall back to the defaults above.
- `STATE_BACKEND` is strict.
  Any value other than `memory` or `redis` throws at startup.
- `PORT` currently uses `Number(...)` directly.
  Give it a numeric string.
- Chat remains single-instance safe today.
  Redis preserves recent history across restarts, but live cross-instance fanout still needs future pub/sub work.

## Client Build-Time Variables

These are read by the Vite client in `apps/client/src/lib/config/env.ts`.

Example templates:

- `apps/client/.env.example`
- `apps/client/.env.production.example`

| Variable | Default | Required | What it does |
| --- | --- | --- | --- |
| `VITE_SOCKET_URL` | unset | required for non-local frontend deployments | Explicit backend WebSocket URL such as `wss://api.example.com/ws`. |
| `VITE_SOCKET_PATH` | `/ws` | no | Socket path used for same-origin fallback or server-side rendering fallback. |

### Client URL Resolution Rules

The client resolves its backend URL in this order:

1. If `VITE_SOCKET_URL` is set, use it as-is.
2. If rendering without `window`, fall back to `ws://localhost:3001${VITE_SOCKET_PATH}`.
3. If running in Vite dev mode or on a localhost-style hostname, use same-origin WebSockets with `VITE_SOCKET_PATH`.
4. Otherwise throw at startup and require `VITE_SOCKET_URL`.

### Important Implication

For production static hosting, the client artifact is environment-specific unless you keep the backend origin stable.
If the frontend URL changes but the backend URL does not, rebuild only if `VITE_SOCKET_URL` changes.

## Docker Build Arguments

The client container accepts build-time socket configuration in `apps/client/Dockerfile`.

| Build arg | Default | What it does |
| --- | --- | --- |
| `VITE_SOCKET_URL` | unset | Passed into the Vite build for explicit backend targeting. |
| `VITE_SOCKET_PATH` | `/ws` | Passed into the Vite build for same-origin fallback path selection. |

The server container does not currently define custom Docker build args.

## Local Docker Compose Defaults

`docker-compose.yml` currently starts three services:

- `redis`
- `server`
- `client`

The Compose file sets these server runtime values:

| Variable | Compose value |
| --- | --- |
| `HOST` | `0.0.0.0` |
| `PORT` | `3001` |
| `WS_PATH` | `/ws` |
| `STATE_BACKEND` | `redis` |
| `REDIS_URL` | `redis://redis:6379` |
| `REDIS_KEY_PREFIX` | `minesweeper-flags-local` |
| `RECONNECT_SESSION_TTL_SECONDS` | `1800` |

The Compose client does not pass `VITE_SOCKET_URL`.
That is intentional because local Compose keeps same-origin behavior and nginx proxies `/ws` to `server:3001`.

## Common Config Recipes

### Local App With Redis-Backed State

Use the existing Compose defaults:

```bash
docker compose up --build
```

Frontend:

- open `http://localhost:8080`
- same-origin `/ws` is proxied by nginx

### Single-Instance Cloud Run Backend

Recommended backend env:

```bash
PORT=3001
HOST=0.0.0.0
WS_PATH=/ws
STATE_BACKEND=memory
TRUST_PROXY=true
```

Recommended frontend build:

```bash
VITE_SOCKET_URL=wss://api.example.com/ws
```

### Redis-Backed Single-Instance Backend

Use this when you want room, match, chat, and reconnect-session persistence across restarts:

```bash
STATE_BACKEND=redis
REDIS_URL=redis://user:password@host:6379
REDIS_KEY_PREFIX=minesweeper-flags-prod
RECONNECT_SESSION_TTL_SECONDS=1800
TRUST_PROXY=true
```

### Tighten Abuse Controls

Example:

```bash
MAX_CONNECTIONS_PER_IP=4
ROOM_CREATE_RATE_LIMIT_MAX=2
ROOM_CREATE_RATE_LIMIT_WINDOW_MS=60000
ROOM_JOIN_RATE_LIMIT_MAX=6
ROOM_JOIN_RATE_LIMIT_WINDOW_MS=60000
CHAT_MESSAGE_RATE_LIMIT_MAX=6
CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS=10000
INVALID_MESSAGE_RATE_LIMIT_MAX=3
INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS=30000
```

### Change The WebSocket Path

Backend:

```bash
WS_PATH=/realtime
```

Client build:

```bash
VITE_SOCKET_PATH=/realtime
```

If you use nginx or another reverse proxy, update that route as well.

## When To Change Which Variable

- Change `VITE_SOCKET_URL` when the frontend must talk to a different backend origin.
- Change `VITE_SOCKET_PATH` and `WS_PATH` together when you move the upgrade path.
- Change `STATE_BACKEND` to `redis` when you need restart-safe shared state.
- Change the chat variables when you want a longer backlog, tighter message caps, or a stricter anti-spam posture.
- Change `REDIS_KEY_PREFIX` when multiple environments share one Redis instance.
- Change `TRUST_PROXY` only when a trusted ingress or managed proxy sits in front of the app.
- Change the rate-limit variables when you need a stricter or looser public-traffic posture.

## Related Docs

- `Makefile`
