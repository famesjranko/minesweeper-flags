# Render demo

Play at [minesweeper-flags-demo.onrender.com](https://minesweeper-flags-demo.onrender.com/).
No account is needed to play. Create a room and invite a friend, or join from a
second browser session.

## Deployment

The root [`render.yaml`](../../render.yaml) defines three resources on a Hobby
workspace. This demo uses hosted-server mode; direct matches and the signaling
service are not deployed.

| Resource | Purpose | Hosting |
| --- | --- | --- |
| `minesweeper-flags-demo` | React frontend | Free static site |
| `minesweeper-flags-api` | Node WebSocket game server | Free web service, Frankfurt |
| `minesweeper-flags-state` | Redis-compatible room, match, chat, and session state | Free Key Value, Frankfurt |

The frontend and server were deployed from
[`64101fa`](https://github.com/famesjranko/minesweeper-flags/commit/64101fad54b1848ad400903fca51ec9baea15b34)
on 21 October 2026. The Blueprint and both services track `main`. Releases are
manual: service auto-deploys, Blueprint auto-sync, and previews are disabled.
GitHub Actions runs checks and image builds; it does not deploy to Render.

## Demo limits

- At most four rooms can exist at once. A finished match still occupies its room
  so the players can chat or rematch. When both players disconnect, the server
  allows 30 seconds for a reload or reconnect before removing the abandoned room.
- Refreshing or reopening an invite can restore a seat in the same browser while
  its saved session and room remain valid. Clearing browser storage or using a
  different browser does not transfer that seat.
- Room and chat storage is temporary. A Key Value restart erases all games and
  sessions; players must create new rooms. There are no durable match records.
- The server runs as one instance. Cross-instance fanout is not implemented.
  This setup is a portfolio demo with limited availability and capacity.

## Cost and platform limits

The configured resources have no base hosting charge. On 21 October 2026, the
workspace's included monthly allowances were:

| Shared allowance | Monthly limit |
| --- | --- |
| Free web-service runtime | 750 hours |
| Outbound bandwidth | 5 GB |
| Build pipeline | 500 minutes |

These allowances cover the whole workspace. Staying within them keeps this setup
at $0. Check Billing in the [Render dashboard](https://dashboard.render.com/)
before a release; pricing and allowances can change.

The server sleeps after 15 idle minutes and takes about a minute to wake. The
client retries automatically. Render may restart free instances at any time.
Free Key Value has 25 MB of memory, 50 connections, and no disk persistence. Its
`noeviction` policy rejects writes when memory is full.

Exhausting free runtime hours suspends free web services until the next month.
Without a payment method, bandwidth overages suspend free services and exhausted
build minutes block new builds. Existing builds remain available when only the
build allowance is exhausted. With a payment method, bandwidth and build overages
can incur charges. Avoid keep-alive jobs, paid resources, and extra preview
instances when operating this as a free demo.

See [Render's free-tier limits](https://render.com/docs/free) and
[pricing](https://render.com/pricing) for current terms.

## First deployment

1. Sign in to Render. Use this repository's public Git URL when creating the
   Blueprint, or connect GitHub with access to this repository.
2. Create a Blueprint from `main`, using `render.yaml`. Keep the workspace
   on Hobby and check that the server and Key Value plans both say Free.
3. In the Blueprint's Settings, set **Auto Sync** to **No**. Service auto-deploys
   and Blueprint auto-sync are separate settings; both must stay off for manual
   releases.
4. Check the assigned public addresses. If Render adds a suffix to either service
   hostname, update the origin allowlist, socket URL, health rewrite, and CSP in
   `render.yaml` to use those actual addresses. Sync the Blueprint and deploy again.
5. Confirm that the server's `/ready` endpoint returns HTTP 200. Open the frontend
   and check that `/api/health` returns JSON with room availability.
6. Create a room and join from another browser session. Check moves, chat,
   rematches, and reconnecting after a page refresh.

Render injects the Key Value connection URL through the Blueprint's service
reference. External Key Value access is disabled. Keep connection strings,
deploy/sync hooks, API keys, and player session tokens out of the repository,
issues, and screenshots. See the [configuration reference](../../docs/config-reference.md)
for environment variables.

## Manual updates

1. Run `make check` and confirm that GitHub Actions checks and image builds pass
   for the release commit. Merge the change into `main` before releasing it.
2. Check `/api/health` on the frontend for room occupancy. Avoid deploying during
   a game; server deployments interrupt connections.
3. In the game server's Render dashboard, use **Manual Deploy → Deploy a specific
   commit** and select the checked commit. Wait for success, then confirm that
   [the server's `/ready` endpoint](https://minesweeper-flags-api.onrender.com/ready)
   returns HTTP 200.
4. Deploy the frontend at the same commit. Check
   [`/api/health`](https://minesweeper-flags-demo.onrender.com/api/health) for JSON
   with `status`, `activeRooms`, and `maxRooms`.
5. Use two browser sessions to check joining, moves, chat, refresh recovery,
   reopening the invite, and rematches. Inspect desktop, tablet, and mobile
   layouts, including chat scrolling and board zoom.
6. Close the test sessions, check usage in Billing, and update the deployment
   commit and date above.

To roll back, manually deploy the same known working commit to both services.
Render's free web plan retains only its two most recent previous deploys for the
dashboard rollback action. Recheck a two-player game after a rollback.

Blueprint synchronization is separate from application deployment. When changing
`render.yaml`, use **Manual sync** on the Blueprint, review the proposed changes,
and select **Approve** to apply them. For application changes, use each service's
**Manual Deploy** menu.

Render preserves existing header rules omitted from the Blueprint. When removing
or changing a rule's path, remove the old rule in the frontend's Headers page too.
Redeploy the frontend after header changes to clear cached response headers.
See the [Blueprint reference](https://render.com/docs/blueprint-spec) for supported
settings.
