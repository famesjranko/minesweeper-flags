# Configuration Reference

This file is the operator-facing reference for the current repo configuration surface.

Source of truth in code:

- `apps/server/src/app/config/env.ts`
- `apps/signaling/src/config/env.ts`
- `apps/server/src/app/state/state-backend.ts`
- `apps/signaling/src/state/state-backend.ts`
- `apps/client/src/lib/config/env.ts`
- `apps/client/Dockerfile`
- `apps/signaling/Dockerfile`
- `apps/client/Dockerfile.public`
- `docker-compose.yml`
- `deploy/container/docker-compose.public.yml`

Example templates in repo:

- `apps/server/.env.example`
- `apps/client/.env.example`
- `apps/client/.env.production.example`
- `deploy/container/public.env.example`
- `deploy/container/public.p2p.env.example`

## At A Glance

The project currently has six configuration layers:

1. Server runtime environment variables.
2. Signaling runtime environment variables.
3. Client build-time variables.
4. Convenience local Docker Compose defaults.
5. Parity/public Docker Compose defaults.
6. Repo-level `Makefile` shortcuts for dev and testing.

The server reads environment variables at process start.
The signaling service also reads environment variables at process start.
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
- `make p2p-dev` runs the client and signaling service in watch mode.
- `make p2p-dev-redis` runs the client and signaling service in watch mode with Redis-backed signaling for parity debugging.
- `make server-dev` runs only the server in watch mode.
- `make signaling-dev` runs only the signaling service in watch mode.
- `make test-server` runs the server test suite.
- `make test-signaling` runs the signaling test suite.
- `make build` builds all workspaces.
- `make compose-up` starts the local Docker Compose stack.
- `make compose-p2p-up` starts the local p2p `client + signaling` stack.
- `make compose-down` stops the local Docker Compose stack.
- `make compose-public-up` starts the parity/public Docker Compose stack.
- `make compose-public-p2p-up` starts the parity/public p2p `client + signaling + redis` stack.
- `make compose-public-down` stops the parity/public Docker Compose stack.
- `make check` runs tests, builds, and validates the Compose config.

Important:

- The `make compose-public-*` targets use the defaults embedded in `deploy/container/docker-compose.public.yml`.
- If you want to override those values, run `docker compose --env-file ... -f deploy/container/docker-compose.public.yml ...` directly.
- `deploy/container/docker-compose.public.p2p.yml` is stricter than the hosted stack by design.
  It now fails fast unless you provide explicit public-facing signaling origin values.

## Server Runtime Variables

These are read by the Node backend in `apps/server/src/app/config/env.ts`.

Example template:

- `apps/server/.env.example`

| Variable | Default | Valid values | Required | What it does |
| --- | --- | --- | --- | --- |
| `DEPLOYMENT_MODE` | `local` | `local`, `public` | no | Controls whether the server uses permissive local defaults or strict public-deploy validation. |
| `PORT` | `3001` | numeric string | no | HTTP and WebSocket listen port. |
| `HOST` | `0.0.0.0` | host or bind address | no | HTTP and WebSocket bind address. |
| `WS_PATH` | `/ws` | path string | no | WebSocket upgrade path. |
| `WEBSOCKET_ALLOWED_ORIGINS` | unset | comma-separated origins or `*` | no | Optional origin allowlist for browser WebSocket upgrades. Leave unset for local dev; set this for public deployments. |
| `MAX_WEBSOCKET_MESSAGE_BYTES` | `16384` | positive integer | no | Maximum accepted inbound WebSocket frame size before the connection is closed. |
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
- `DEPLOYMENT_MODE` is strict.
  Any value other than `local` or `public` throws at startup.
- `STATE_BACKEND` is strict.
  Any value other than `memory` or `redis` throws at startup.
- `DEPLOYMENT_MODE=public` requires:
  `STATE_BACKEND=redis`, explicit `WEBSOCKET_ALLOWED_ORIGINS`, `TRUST_PROXY=true`, and a valid positive `PORT`.
- `WEBSOCKET_ALLOWED_ORIGINS` normalizes entries to URL origins.
  Example: `https://app.example.com,https://www.example.com`.
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
| `VITE_DEPLOYMENT_MODE` | `server` | no | Selects the frontend product shape. Use `server` for the hosted backend flow and `p2p` for direct match plus signaling. |
| `VITE_P2P_STUN_URLS` | unset | no | Comma-separated STUN URLs used by WebRTC in `p2p` builds. |
| `VITE_P2P_SIGNALING_URL` | unset | required when `VITE_DEPLOYMENT_MODE=p2p` | Base URL for the automated signaling service, such as `https://signal.example.com`. |

### Deployment-Aware Client Rules

- `VITE_DEPLOYMENT_MODE=server` keeps the current hosted WebSocket flow.
- `VITE_DEPLOYMENT_MODE=p2p` removes the hosted room flow from the product UI and requires `VITE_P2P_SIGNALING_URL`.
- `p2p` builds do not require `VITE_SOCKET_URL`.
- Direct matches still use STUN only in this version.
- Live direct matches recover after host or guest refresh by using browser-local recovery data plus reconnect control sessions in signaling. The host browser stays the gameplay authority across the refresh.
- Opening the same direct match in a second tab is detected: the new tab claims control and the displaced tab shows a conflict notice. The displaced tab keeps its recovery data so the user can click `Reconnect` to reclaim ownership.
- If both peers lose their local browser state, signaling still does not preserve gameplay authority or match state for recovery.

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

The client containers accept build-time deployment configuration in `apps/client/Dockerfile` and `apps/client/Dockerfile.public`.

| Build arg | Default | What it does |
| --- | --- | --- |
| `VITE_SOCKET_URL` | unset | Passed into the Vite build for explicit backend targeting. |
| `VITE_SOCKET_PATH` | `/ws` | Passed into the Vite build for same-origin fallback path selection. |
| `VITE_DEPLOYMENT_MODE` | `server` | Selects the hosted or direct-match product path for the built client artifact. |
| `VITE_P2P_STUN_URLS` | unset | Passed into the Vite build for WebRTC STUN configuration. |
| `VITE_P2P_SIGNALING_URL` | unset | Passed into the Vite build for the automated signaling base URL used by `p2p` deployments. |

The public client container also accepts this runtime env var:

| Variable | Default | What it does |
| --- | --- | --- |
| `CSP_CONNECT_SRC` | `http://localhost:3001 ws://localhost:3001 http://localhost:3002` | Sets the allowed `connect-src` values in the public nginx CSP header. Include the signaling origin for `p2p` deployments. |

The signaling container does not currently define custom Docker build args.

## Signaling Runtime Variables

These are read by the signaling service in `apps/signaling/src/config/env.ts`.

| Variable | Default | Valid values | Required | What it does |
| --- | --- | --- | --- | --- |
| `DEPLOYMENT_MODE` | `local` | `local`, `public` | no | Controls permissive local defaults versus stricter public validation for the signaling service. |
| `HOST` | `0.0.0.0` | host or bind address | no | HTTP bind address for the signaling service. |
| `PORT` | `3002` | numeric string | no | HTTP listen port for the signaling service. |
| `STATE_BACKEND` | `memory` | `memory`, `redis` | no | Selects in-memory or Redis-backed signaling session storage. |
| `REDIS_URL` | unset | Redis URL | yes when `STATE_BACKEND=redis` | Redis connection string used by the signaling store. |
| `REDIS_KEY_PREFIX` | `minesweeper-flags:signaling` | string | no | Prefix for all signaling keys written to Redis. |
| `P2P_SIGNALING_SESSION_TTL_SECONDS` | `900` | positive integer | no | Active lifetime for short-lived offer/answer/finalization signaling sessions. Redis-backed signaling retains expired records for a short fixed grace window so polling reads can still return `state: "expired"` before cleanup. |
| `P2P_SIGNALING_MAX_PAYLOAD_BYTES` | `16384` | positive integer | no | Maximum accepted signaling request size. |
| `TRUST_PROXY` | `false` | `true` or `false` | no | Enables trusted `X-Forwarded-For` handling for signaling rate limits. In the supported single-proxy shape, signaling uses the last forwarded address, so your trusted ingress should overwrite the header or append the real client IP last. |
| `SIGNALING_ALLOWED_ORIGINS` | unset | comma-separated origins or `*` | no for local, yes for public | Browser origin allowlist for signaling requests. Public mode requires an explicit allowlist, not `*`. |
| `SIGNALING_CREATE_RATE_LIMIT_MAX` | `6` | positive integer | no | Maximum session-create requests allowed per rate-limit window per client IP. |
| `SIGNALING_CREATE_RATE_LIMIT_WINDOW_MS` | `60000` | positive integer | no | Rate-limit window for session creation. |
| `SIGNALING_ANSWER_RATE_LIMIT_MAX` | `12` | positive integer | no | Maximum answer submissions allowed per rate-limit window per client IP. |
| `SIGNALING_ANSWER_RATE_LIMIT_WINDOW_MS` | `60000` | positive integer | no | Rate-limit window for answer submission. |
| `SIGNALING_RECONNECT_RATE_LIMIT_MAX` | `240` | positive integer | no | Maximum reconnect-control requests (register, claim, heartbeat, offer, answer, finalize, and their `/read` variants) allowed per rate-limit window per client IP. Shared bucket across the entire reconnect endpoint family. |
| `SIGNALING_RECONNECT_RATE_LIMIT_WINDOW_MS` | `60000` | positive integer | no | Rate-limit window for reconnect-control requests. |

### Signaling Deployment Rules

- `DEPLOYMENT_MODE=public` requires `STATE_BACKEND=redis`.
- `DEPLOYMENT_MODE=public` requires `REDIS_URL`.
- `DEPLOYMENT_MODE=public` requires `SIGNALING_ALLOWED_ORIGINS` to be an explicit allowlist.
- `DEPLOYMENT_MODE=public` requires `TRUST_PROXY=true`.
- With `TRUST_PROXY=true`, the supported shape is a single trusted ingress that overwrites `X-Forwarded-For` or appends the real client IP last.
- Local dev may use the in-memory backend because signaling sessions are short-lived and setup-only.
- With `STATE_BACKEND=redis`, `expiresAt` remains the source of truth for whether a session is active.
  Redis expiry is intentionally a little longer than the active TTL so reads can surface `expired` instead of `not found`, then the record is cleaned up automatically.

## Convenience Local Docker Compose Defaults

`docker-compose.yml` currently defines four services:

- `redis`
- `server`
- `signaling`
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

For local p2p runs, use:

```bash
make compose-p2p-up
```

That shape runs:

- `client`
- `signaling`

With these notable defaults:

```bash
VITE_DEPLOYMENT_MODE=p2p
VITE_P2P_SIGNALING_URL=http://localhost:3002
STATE_BACKEND=memory
PORT=3002
```

## Parity/Public Docker Compose Defaults

`deploy/container/docker-compose.public.yml` also defines four services:

- `redis`
- `server`
- `signaling`
- `client`

Its main purpose is to keep local production-like testing close to the public deployment shape.

The parity/public Compose file sets these server runtime values by default:

| Variable | Compose value |
| --- | --- |
| `DEPLOYMENT_MODE` | `public` |
| `HOST` | `0.0.0.0` |
| `PORT` | `3001` |
| `WS_PATH` | `/ws` |
| `STATE_BACKEND` | `redis` |
| `REDIS_URL` | `redis://redis:6379` |
| `TRUST_PROXY` | `true` |
| `WEBSOCKET_ALLOWED_ORIGINS` | `http://localhost:8080` |
| `REDIS_KEY_PREFIX` | `minesweeper-flags-public` |
| `RECONNECT_SESSION_TTL_SECONDS` | `1800` |

The parity/public Compose client builds with an explicit `VITE_SOCKET_URL` and serves the frontend without a `/ws` proxy.

For parity/public p2p runs, use:

```bash
make compose-public-p2p-up
```

That shape runs:

- `redis`
- `signaling`
- `client`

With these notable requirements:

```bash
DEPLOYMENT_MODE=public
STATE_BACKEND=redis
VITE_DEPLOYMENT_MODE=p2p
VITE_P2P_SIGNALING_URL=https://signal.example.com
SIGNALING_ALLOWED_ORIGINS=https://app.example.com
CSP_CONNECT_SRC=https://signal.example.com
TRUST_PROXY=true
```

Public p2p requires Redis-backed signaling even though gameplay remains browser-to-browser.
The Compose file does not inject localhost fallbacks for those browser-facing values anymore.
Provide them explicitly through your shell or an env file so public deploys fail fast instead of silently building a broken client.

## Common Config Recipes

### Convenience Local App With Redis-Backed State

Use the existing Compose defaults:

```bash
docker compose up --build
```

Frontend:

- open `http://localhost:8080`
- same-origin `/ws` is proxied by nginx

### Parity-Local Stack

Use the parity/public Compose overlay with the built-in localhost defaults:

```bash
make compose-public-up
```

Default local parity values:

```bash
DEPLOYMENT_MODE=public
VITE_SOCKET_URL=ws://localhost:3001/ws
WEBSOCKET_ALLOWED_ORIGINS=http://localhost:8080
CSP_CONNECT_SRC=http://localhost:3001 ws://localhost:3001
```

To run the same stack with an explicit env file instead of the baked-in defaults:

```bash
docker compose --env-file deploy/container/public.env.example -f deploy/container/docker-compose.public.yml up --build
```

### Local Direct Match Stack

Use this when you want the normal automated direct-match flow locally:

```bash
make p2p-dev
```

Or the containerized equivalent:

```bash
make compose-p2p-up
```

If you want the same local browser flow with Redis-backed signaling for closer public-shape debugging, use:

```bash
make p2p-dev-redis
```

That keeps the client and signaling service running in watch mode, but starts Redis through Docker Compose and points signaling at `redis://127.0.0.1:6379`.

Flow summary:

1. Host clicks `Host Direct Match`.
2. The client creates a short join link through the signaling service.
3. Guest opens `/p2p/join/:sessionId`, enters a display name, and joins.
4. Offer, answer, and finalization stay inside the app.
5. After both peers connect, live direct matches survive host or guest tab refresh through browser-local recovery plus a small reconnect control session in signaling. The host browser remains the gameplay authority; signaling never stores gameplay state.
6. Opening the same direct match in a second tab claims control in the new tab. The displaced tab shows a conflict notice and can click `Reconnect` to reclaim. If the signaling session is gone for good (404/410), the displaced tab is told to start a new direct match.

### Public Direct Match Stack

Use this when you want the public deployment shape for P2P:

```bash
docker compose --env-file deploy/container/public.p2p.env.example -f deploy/container/docker-compose.public.p2p.yml up --build
```

Recommended values:

```bash
VITE_DEPLOYMENT_MODE=p2p
VITE_P2P_SIGNALING_URL=https://signal.example.com
SIGNALING_ALLOWED_ORIGINS=https://app.example.com
CSP_CONNECT_SRC=https://signal.example.com
TRUST_PROXY=true
STATE_BACKEND=redis
REDIS_URL=redis://user:password@host:6379
```

For localhost parity testing with that same file, set those variables explicitly to localhost values in your env file instead of relying on baked-in defaults.

### Redis-Backed Public Single-Instance Backend

Use this when you want room, match, chat, and reconnect-session persistence across restarts and want the same runtime contract you tested locally:

```bash
DEPLOYMENT_MODE=public
STATE_BACKEND=redis
REDIS_URL=redis://user:password@host:6379
REDIS_KEY_PREFIX=minesweeper-flags-prod
RECONNECT_SESSION_TTL_SECONDS=1800
WEBSOCKET_ALLOWED_ORIGINS=https://app.example.com
MAX_WEBSOCKET_MESSAGE_BYTES=16384
TRUST_PROXY=true
```

Recommended frontend build:

```bash
VITE_SOCKET_URL=wss://api.example.com/ws
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
- Change `VITE_DEPLOYMENT_MODE` to `p2p` when you want the direct-match product path instead of the hosted server flow.
- Change `VITE_P2P_SIGNALING_URL` when the `p2p` frontend must talk to a different signaling origin.
- Change `DEPLOYMENT_MODE` to `public` when you want strict validation of production-safe server settings.
- Change signaling `DEPLOYMENT_MODE` to `public` when you publish the signaling service on a browser-facing origin and want strict Redis/origin validation.
- Change `WEBSOCKET_ALLOWED_ORIGINS` when you publish the backend behind a browser-facing frontend origin.
- Change `SIGNALING_ALLOWED_ORIGINS` when you publish the signaling service behind a browser-facing frontend origin.
- Change `MAX_WEBSOCKET_MESSAGE_BYTES` only if your client protocol legitimately needs larger inbound frames.
- Change `STATE_BACKEND` to `redis` when you need restart-safe shared state.
- Change the chat variables when you want a longer backlog, tighter message caps, or a stricter anti-spam posture.
- Change `REDIS_KEY_PREFIX` when multiple environments share one Redis instance.
- Change signaling `REDIS_KEY_PREFIX` when multiple environments share one Redis instance for rendezvous state.
- Change `TRUST_PROXY` only when a trusted ingress or managed proxy sits in front of the app.
- Change the rate-limit variables when you need a stricter or looser public-traffic posture.

## Related Docs

- `Makefile`
- `deploy/container/README.md`
