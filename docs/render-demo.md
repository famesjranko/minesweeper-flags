# Render demo

Play at [minesweeper-flags-demo.onrender.com](https://minesweeper-flags-demo.onrender.com/).
No account is needed to play. Create a room and invite a friend, or join from a
second browser session.

## Deployment

The root [`render.yaml`](../render.yaml) defines three resources on a Hobby
workspace. This demo uses hosted-server mode; direct matches and the signaling
service are not deployed.

| Resource | Purpose | Hosting |
| --- | --- | --- |
| `minesweeper-flags-demo` | React frontend | Free static site |
| `minesweeper-flags-api` | Node WebSocket game server | Free web service, Frankfurt |
| `minesweeper-flags-state` | Redis-compatible room, match, chat, and session state | Free Key Value, Frankfurt |

Last verified on 21 October 2026:

| Service | Deployed commit | Deployment date |
| --- | --- | --- |
| Frontend | [`62a0d94`](https://github.com/famesjranko/minesweeper-flags/commit/62a0d94ccd3c94f369903bf2a397aa27868eb20a) | 21 October 2026 |
| Game server | [`64101fa`](https://github.com/famesjranko/minesweeper-flags/commit/64101fad54b1848ad400903fca51ec9baea15b34) | 21 October 2026 |

The frontend update changed only the UI; server code and the shared protocol are
identical at these commits. The Blueprint and both services track `main`.
Releases are manual: service auto-deploys, Blueprint auto-sync, and previews are
disabled. GitHub Actions runs checks and image builds; it does not deploy to Render.

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

## Forking and deploying your own copy

Forking copies the repository files. It does not provision Render resources or
give the fork access to this demo's Render workspace, credentials, or billing.
GitHub disables workflows in forks by default. If the fork owner enables them,
this repository's workflow runs checks and image builds, with no deployment job.
A pull request back to this repository can run its CI checks, subject to workflow
approval rules. See [GitHub's fork workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflows-in-forked-repositories).

To host a fork, create a Blueprint in your own Render workspace from your fork's
repository. The Blueprint omits `repo`, so each application builds from the
repository containing that Blueprint. The Key Value service reference resolves
within your workspace. Review the proposed resources before deploying, especially
if your workspace already contains services with the same names. Resources you
create count against your workspace's allowances and billing. See
[Render's Blueprint setup](https://render.com/docs/infrastructure-as-code#setup)
and [service references](https://render.com/docs/blueprint-spec#referencing-service-properties).

The checked-in `render.yaml` contains the public demo's hostnames. Deploying it
unchanged would leave your frontend targeting the original demo API. Game
connections from your different browser origin are rejected by the demo's
allowlist, but health requests still reach the original API and can consume its
free allowance. The API is public; the origin check is not authentication.

Replace these four settings in your fork's `render.yaml` with your own assigned
hostnames, then sync the Blueprint and redeploy:

| Setting | Value for your deployment |
| --- | --- |
| Server `WEBSOCKET_ALLOWED_ORIGINS` | Your frontend's HTTPS origin |
| Frontend `VITE_SOCKET_URL` | Your server's `wss://` URL ending in `/ws` |
| Frontend `/api/health` rewrite destination | Your server's HTTPS URL ending in `/health` |
| Frontend CSP `connect-src` | `'self'` and your server's HTTPS and `wss://` origins |

Check the actual hostnames in Render; a name collision can add a suffix. If you
rename services, also update their `fromService.name` references. Before opening
the new frontend, confirm that this search finds no original demo hostnames in
your fork's deployment configuration:

```bash
rg -n 'minesweeper-flags-(api|demo)\.onrender\.com' render.yaml
```

Use the setup and verification steps below with your own URLs. Forking alone
does not redirect the README's live-demo link; change that link if you publish
your own demo.

## First deployment

1. Sign in to Render. Use your repository's public Git URL when creating the
   Blueprint, or connect GitHub with access to your repository. For a fork, follow
   the hostname changes above before using the new frontend.
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
issues, and screenshots. See the [configuration reference](config-reference.md)
for environment variables.

## Manual updates

1. Merge the change into `main`. Run `make check` and confirm that GitHub Actions
   checks and image builds pass for the selected release commit.
2. Check `/api/health` on the frontend for room occupancy. Avoid deploying during
   a game; server deployments interrupt connections.
3. For server or shared-protocol changes, deploy the game server first. In its
   Render dashboard, use **Manual Deploy → Deploy a specific commit** and select
   the checked commit. Wait for success, then confirm that
   [the server's `/ready` endpoint](https://minesweeper-flags-api.onrender.com/ready)
   returns HTTP 200.
4. Deploy the frontend at the same commit. A frontend-only release can leave the
   server at its existing commit when server code and the shared protocol are
   unchanged. Check
   [`/api/health`](https://minesweeper-flags-demo.onrender.com/api/health) for JSON
   with `status`, `activeRooms`, and `maxRooms`.
5. Use two browser sessions to check joining, moves, chat, refresh recovery,
   reopening the invite, and rematches. Inspect desktop, tablet, and mobile
   layouts, including chat scrolling and board zoom.
6. Close the test sessions, check usage in Billing, and update each affected
   service's deployment commit and date above.

To roll back, restore the recorded compatible pair of frontend and server commits.
For a frontend-only release, restore the previous frontend commit without
restarting the unchanged server.
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
