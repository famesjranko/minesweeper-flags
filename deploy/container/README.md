# Container Deploy Overlay

This folder contains the parity-first public deployment overlay.

## Goals

- keep `make dev` and the root `docker-compose.yml` as lightweight local workflows
- provide one container stack that doubles as:
  - local parity testing
  - the reference public single-instance deployment shape
- keep frontend and backend on split origins, matching public deployment behavior

## Files

- `docker-compose.public.yml` starts `client`, `server`, and `redis`
- `public.env.example` shows the environment contract for parity-local and public runs
- `docker-compose.public.p2p.yml` starts `client`, `signaling`, and `redis`
- `public.p2p.env.example` shows the explicit env contract for public or parity-local p2p runs

Important:

- `make compose-public-up` uses the defaults embedded in `docker-compose.public.yml`
- `public.env.example` is for explicit `docker compose --env-file ...` runs
- copying values to `deploy/container/.env` is not enough unless you also point Compose at that file

## Local parity run

1. Use the baked-in defaults with:

```bash
make compose-public-up
```

2. Or run Compose directly with an explicit env file:

```bash
docker compose --env-file deploy/container/public.env.example -f deploy/container/docker-compose.public.yml up --build
```

3. Keep the default localhost values:
   - frontend at `http://localhost:8080`
   - backend at `ws://localhost:3001/ws`

This exercises the production-like behavior locally:

- `DEPLOYMENT_MODE=public`
- `STATE_BACKEND=redis`
- explicit `VITE_SOCKET_URL`
- explicit `WEBSOCKET_ALLOWED_ORIGINS`
- split frontend/backend origins

## Public deployment assumptions

- TLS is terminated by the external ingress or load balancer
- the ingress forwards `X-Forwarded-For`
- the ingress supports WebSocket upgrades
- backend instance count stays at `1`
- frontend and backend are exposed on separate origins such as:
  - `https://app.example.com`
  - `wss://api.example.com/ws`

## Public p2p overlay

- `docker-compose.public.p2p.yml` intentionally does not default browser-facing signaling values to localhost.
- You must set `VITE_P2P_SIGNALING_URL`, `SIGNALING_ALLOWED_ORIGINS`, and `CSP_CONNECT_SRC` explicitly.
- For public deploys, use real origins such as:
  - `VITE_P2P_SIGNALING_URL=https://signal.example.com`
  - `SIGNALING_ALLOWED_ORIGINS=https://app.example.com`
  - `CSP_CONNECT_SRC=https://signal.example.com`
- For localhost parity testing with that same file, put explicit localhost values in `public.p2p.env.example` or your own env file.
- Signaling stays small and non-authoritative: it brokers offer/answer rendezvous and short-lived reconnect control sessions, but the host browser owns all gameplay state. Live direct matches recover after host or guest tab refresh through browser-local recovery plus the reconnect control session. If signaling state is lost, peers must start a new direct match.
- The compose file remaps `SIGNALING_REDIS_KEY_PREFIX` from the env file to the signaling service's `REDIS_KEY_PREFIX` variable. If you run the signaling image outside Compose, set `REDIS_KEY_PREFIX` directly instead.

## Recommended public values

- `VITE_SOCKET_URL=wss://api.example.com/ws`
- `CSP_CONNECT_SRC=https://api.example.com wss://api.example.com`
- `WEBSOCKET_ALLOWED_ORIGINS=https://app.example.com`
- `TRUST_PROXY=true`
