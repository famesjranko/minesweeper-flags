# Render demo

The root [`render.yaml`](../../render.yaml) defines the hosted demo: a static
frontend, one game server, and a Redis-compatible Key Value instance. The server
and database use Render's free compute plans. The frontend uses its free static
hosting. There is no signaling service in this deployment.

Play at [minesweeper-flags-demo.onrender.com](https://minesweeper-flags-demo.onrender.com/).
The deployed resources are:

- [Blueprint](https://dashboard.render.com/blueprint/exs-dbbol8eq1p3s73daegeg)
- [Game server](https://dashboard.render.com/web/srv-dbbolfks728c7395c4q0)
- [Frontend](https://dashboard.render.com/static/srv-dbboldss728c7395bvb0)
- [Key Value](https://dashboard.render.com/r/red-dbboldss728c7395bv90)

The initial game server runs commit `60f5f38` from
`t3/deploy-minesweeper-demo`. The frontend and Blueprint headers were updated at
`1e987e9`. Both public hostnames match the Blueprint.

## First deployment

1. Sign in to Render. Use this repository's public Git URL when creating the
   Blueprint, or connect GitHub with access to this repository.
2. Create a Blueprint from the branch containing `render.yaml`. Keep the workspace
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

Redis uses Render's internal connection URL. Do not enable external database
access. No application secrets need to be entered in the Blueprint.

## Manual updates

Run `make check` before publishing a deployment commit. In each web service's
Render dashboard, use **Manual Deploy → Deploy a specific commit** and select the
checked commit. Deploy the server first and the frontend second. Both services
must run compatible protocol versions. Avoid updates during a game; server
deployments interrupt connections.

After the deployment branch is merged, change the Blueprint and both web services
to track `main`. Keep automatic deploys and pull request previews disabled.

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

## Free hosting limits

- The game server sleeps after 15 minutes without incoming traffic. Waking it
  usually takes about a minute. The client retries connections automatically.
- A free Key Value restart erases rooms, matches, chat, and reconnect sessions.
  Players must create a new room after that happens.
- The server supports four concurrent rooms. The free Key Value instance has
  25 MB of memory and a 50-connection limit. Its `noeviction` policy refuses writes
  when memory is full instead of silently deleting game state.
- Free web-service hours, outbound bandwidth, and build minutes are shared with
  other services in the workspace. Check Render's usage dashboard and its usage
  notification emails. Do not add keep-alive requests or paid resources.
- Without a payment method, exceeding bandwidth limits suspends the free services
  for the rest of the month. Exhausted build minutes block new builds while the
  existing deployment remains available.

See [Render's free-tier limits](https://render.com/docs/free) and
[Blueprint reference](https://render.com/docs/blueprint-spec) for current terms.
